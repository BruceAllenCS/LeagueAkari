import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { isPveQueue } from '@shared/types/league-client/match-history'

const BASE_SCORE = 100
const RECENT_WINDOW_HOURS = 5
const RECENT_WEIGHT = 0.8
const OLD_WEIGHT = 0.2

const RANKING_SCORE: Record<number, number> = {
  0: 10,
  1: 5,
  2: 0,
  3: -5,
  4: -10
}

const GRADE_THRESHOLDS = {
  S: 180,
  A: 150,
  B: 125,
  C: 105,
  D: 95
} as const

const MULTI_KILL_BONUS = {
  triple: 5,
  quadra: 10,
  penta: 20
} as const

// Keep the original template's numeric-key iteration order for score compatibility.
const CS_BONUS: Record<number, number> = {
  10: 20,
  9: 10,
  8: 5
}

const CONTRIBUTION_BONUS = {
  heavy: [
    [15, 40],
    [10, 20],
    [5, 10]
  ],
  light: [
    [15, 20],
    [10, 10],
    [5, 5]
  ]
} as const

export type HorseGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

export interface HorseRating {
  score: number
  grade: HorseGrade
  matchCount: number
  averageKda: number
  winRate: number
}

interface NormalizedParticipant {
  identifier: string
  puuid?: string
  teamId: number
  isSupport: boolean | null
  win: boolean
  firstBloodKill: boolean
  firstBloodAssist: boolean
  tripleKills: number
  quadraKills: number
  pentaKills: number
  kills: number
  deaths: number
  assists: number
  goldEarned: number
  totalDamageDealtToChampions: number
  visionScore: number
  totalMinionsKilled: number
  neutralMinionsKilled: number
}

interface ExtractedGame {
  isRecent: boolean
  win: boolean
  isSupport: boolean | null
  isFirstBlood: boolean
  isFirstBloodAssist: boolean
  triple: number
  quadra: number
  penta: number
  kills: number
  deaths: number
  assists: number
  kprRank: number
  goldRank: number
  damageRank: number
  visionRank: number
  isKillShareOver35: boolean
  isKillShareOver50: boolean
  isDamageShareOver35: boolean
  isDamageShareOver50: boolean
  isAssistShareOver35: boolean
  isAssistShareOver50: boolean
  csPerMinute: number
  kpr: number
  kda: number
  memberCount: number
}

function noZero(value: number) {
  return value === 0 ? 1 : value
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sumBy<T>(values: T[], pick: (value: T) => number) {
  return values.reduce((sum, value) => sum + pick(value), 0)
}

function normalizeLcuParticipants(gameSummary: Extract<LcuOrSgpGameSummary, { source: 'lcu' }>) {
  const identityByParticipantId = new Map(
    gameSummary.data.participantIdentities.map((identity) => [
      identity.participantId,
      identity.player.puuid
    ])
  )

  return gameSummary.data.participants.map<NormalizedParticipant>((participant) => ({
    identifier: String(participant.participantId),
    teamId: participant.teamId,
    isSupport: null,
    win: participant.stats.win,
    firstBloodKill: participant.stats.firstBloodKill,
    firstBloodAssist: participant.stats.firstBloodAssist,
    tripleKills: participant.stats.tripleKills,
    quadraKills: participant.stats.quadraKills,
    pentaKills: participant.stats.pentaKills,
    kills: participant.stats.kills,
    deaths: participant.stats.deaths,
    assists: participant.stats.assists,
    goldEarned: participant.stats.goldEarned,
    totalDamageDealtToChampions: participant.stats.totalDamageDealtToChampions,
    visionScore: participant.stats.visionScore,
    totalMinionsKilled: participant.stats.totalMinionsKilled,
    neutralMinionsKilled: participant.stats.neutralMinionsKilled,
    puuid: identityByParticipantId.get(participant.participantId)
  }))
}

function normalizeSgpParticipants(gameSummary: Extract<LcuOrSgpGameSummary, { source: 'sgp' }>) {
  return gameSummary.data.json.participants.map<NormalizedParticipant>((participant) => ({
    identifier: String(participant.participantId ?? participant.puuid),
    teamId: participant.teamId,
    isSupport: participant.teamPosition === 'UTILITY',
    win: participant.win,
    firstBloodKill: participant.firstBloodKill,
    firstBloodAssist: participant.firstBloodAssist,
    tripleKills: participant.tripleKills,
    quadraKills: participant.quadraKills,
    pentaKills: participant.pentaKills,
    kills: participant.kills,
    deaths: participant.deaths,
    assists: participant.assists,
    goldEarned: participant.goldEarned,
    totalDamageDealtToChampions: participant.totalDamageDealtToChampions,
    visionScore: participant.visionScore,
    totalMinionsKilled: participant.totalMinionsKilled,
    neutralMinionsKilled: participant.neutralMinionsKilled,
    puuid: participant.puuid
  }))
}

function extractGame(
  puuid: string,
  gameSummary: LcuOrSgpGameSummary,
  now: number
): ExtractedGame | null {
  const participants =
    gameSummary.source === 'lcu'
      ? normalizeLcuParticipants(gameSummary)
      : normalizeSgpParticipants(gameSummary)
  const me = participants.find((participant) => participant.puuid === puuid)

  if (!me) {
    return null
  }

  const teammates = participants.filter((participant) => participant.teamId === me.teamId)
  const totalKills = sumBy(teammates, (participant) => participant.kills || 0)
  const totalDamage = sumBy(
    teammates,
    (participant) => participant.totalDamageDealtToChampions || 0
  )
  const totalAssists = sumBy(teammates, (participant) => participant.assists || 0)

  const rank = (participantsByRank: NormalizedParticipant[]) =>
    participantsByRank.findIndex((participant) => participant.identifier === me.identifier)
  const sortBy = (pick: (participant: NormalizedParticipant) => number) =>
    teammates.toSorted((a, b) => pick(b) - pick(a))

  const kprRank = rank(
    teammates.toSorted((a, b) => {
      const aKillAssists = (a.kills || 0) + (a.assists || 0)
      const bKillAssists = (b.kills || 0) + (b.assists || 0)

      return aKillAssists === bKillAssists
        ? (a.deaths || 0) - (b.deaths || 0)
        : bKillAssists - aKillAssists
    })
  )
  const goldRank = rank(sortBy((participant) => participant.goldEarned || 0))
  const damageRank = rank(sortBy((participant) => participant.totalDamageDealtToChampions || 0))
  const visionRank = rank(sortBy((participant) => participant.visionScore || 0))

  const killShare = (me.kills || 0) / noZero(totalKills)
  const damageShare = (me.totalDamageDealtToChampions || 0) / noZero(totalDamage)
  const assistShare = (me.assists || 0) / noZero(totalAssists)
  const game = gameSummary.source === 'lcu' ? gameSummary.data : gameSummary.data.json
  const durationMinutes = Math.max(game.gameDuration || 0, 1) / 60
  const totalCs = (me.totalMinionsKilled || 0) + (me.neutralMinionsKilled || 0)
  const kills = me.kills || 0
  const assists = me.assists || 0
  const killAssists = kills + assists
  const deaths = me.deaths ?? 0

  return {
    isRecent: now - game.gameCreation < RECENT_WINDOW_HOURS * 60 * 60 * 1000,
    win: me.win,
    isSupport: me.isSupport,
    isFirstBlood: me.firstBloodKill || false,
    isFirstBloodAssist: me.firstBloodAssist || false,
    triple: me.tripleKills || 0,
    quadra: me.quadraKills || 0,
    penta: me.pentaKills || 0,
    kills,
    deaths,
    assists,
    kprRank,
    goldRank,
    damageRank,
    visionRank,
    isKillShareOver35: killShare > 0.35,
    isKillShareOver50: killShare > 0.5,
    isDamageShareOver35: damageShare > 0.35,
    isDamageShareOver50: damageShare > 0.5,
    isAssistShareOver35: assistShare > 0.35,
    isAssistShareOver50: assistShare > 0.5,
    csPerMinute: totalCs / durationMinutes,
    kpr: killAssists / noZero(totalKills),
    kda: killAssists / noZero(deaths),
    memberCount: teammates.length
  }
}

function contributionBonus(heavy: boolean, count: number) {
  const table = CONTRIBUTION_BONUS[heavy ? 'heavy' : 'light']

  for (const [threshold, bonus] of table) {
    if (count > threshold) {
      return bonus
    }
  }

  return 0
}

function calculateHorseGameScore(stats: ExtractedGame) {
  let score = BASE_SCORE

  if (stats.isFirstBlood) score += 10
  if (stats.isFirstBloodAssist) score += 5

  score +=
    (stats.triple ? MULTI_KILL_BONUS.triple : 0) +
    (stats.quadra ? MULTI_KILL_BONUS.quadra : 0) +
    (stats.penta ? MULTI_KILL_BONUS.penta : 0)

  score += RANKING_SCORE[stats.kprRank] ?? 0
  if (stats.isSupport ? stats.goldRank <= 1 : true) {
    score += RANKING_SCORE[stats.goldRank] ?? 0
  }
  if (stats.damageRank <= 1) {
    score += RANKING_SCORE[stats.damageRank] ?? 0
  }
  if (stats.visionRank <= 1) {
    score += RANKING_SCORE[stats.visionRank] ?? 0
  }

  score += stats.isKillShareOver50
    ? contributionBonus(true, stats.kills)
    : stats.isKillShareOver35
      ? contributionBonus(false, stats.kills)
      : 0
  score += stats.isAssistShareOver50
    ? contributionBonus(true, stats.assists)
    : stats.isAssistShareOver35
      ? contributionBonus(false, stats.assists)
      : 0
  score += stats.isDamageShareOver50
    ? contributionBonus(true, stats.kills)
    : stats.isDamageShareOver35
      ? contributionBonus(false, stats.kills)
      : 0

  for (const cs in CS_BONUS) {
    if (stats.csPerMinute >= Number(cs)) {
      score += CS_BONUS[Number(cs)]
      break
    }
  }

  score += stats.kda + ((stats.kills - stats.deaths) / noZero(stats.memberCount)) * stats.kpr

  return score
}

function mergeScores(games: ExtractedGame[]) {
  const recentScores = games
    .filter((game) => game.isRecent)
    .map((game) => calculateHorseGameScore(game))
  const oldScores = games
    .filter((game) => !game.isRecent)
    .map((game) => calculateHorseGameScore(game))

  if (!recentScores.length) return average(oldScores)
  if (!oldScores.length) return average(recentScores)

  return average(recentScores) * RECENT_WEIGHT + average(oldScores) * OLD_WEIGHT
}

export function getHorseGrade(score: number, isAlly: boolean): HorseGrade {
  if (score >= GRADE_THRESHOLDS.S) return 'S'
  if (score >= GRADE_THRESHOLDS.A) return 'A'
  if (score >= GRADE_THRESHOLDS.B) return 'B'
  if (score >= GRADE_THRESHOLDS.C) return 'C'
  if (score >= GRADE_THRESHOLDS.D) return 'D'

  return isAlly ? 'E' : 'F'
}

export function getGameQueueId(gameSummary: LcuOrSgpGameSummary) {
  return gameSummary.source === 'lcu' ? gameSummary.data.queueId : gameSummary.data.json.queueId
}

export function calculateHorseRating(
  puuid: string,
  matchHistory: LcuOrSgpGameSummary[],
  currentQueueId: number,
  isAlly: boolean,
  now = Date.now()
): HorseRating | null {
  const games = matchHistory
    .filter((gameSummary) => {
      const queueId = getGameQueueId(gameSummary)
      return queueId === currentQueueId && !isPveQueue(queueId)
    })
    .map((gameSummary) => extractGame(puuid, gameSummary, now))
    .filter((game): game is ExtractedGame => game !== null)

  if (!games.length) {
    return null
  }

  const score = mergeScores(games)

  return {
    score,
    grade: getHorseGrade(score, isAlly),
    matchCount: games.length,
    averageKda: average(games.map((game) => game.kda)),
    winRate: games.filter((game) => game.win).length / games.length
  }
}
