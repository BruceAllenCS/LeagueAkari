import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { describe, expect, it } from 'vitest'

import { calculateHorseRating, getGameQueueId, getHorseGrade } from './scoring'

const NOW = new Date('2026-08-20T12:00:00.000Z').getTime()

interface ParticipantOverrides {
  kills?: number
  deaths?: number
  assists?: number
  goldEarned?: number
  totalDamageDealtToChampions?: number
  visionScore?: number
  totalMinionsKilled?: number
  neutralMinionsKilled?: number
  firstBloodKill?: boolean
  firstBloodAssist?: boolean
  tripleKills?: number
  quadraKills?: number
  pentaKills?: number
  win?: boolean
  teamPosition?: string
}

function participantStats(overrides: ParticipantOverrides = {}) {
  return {
    kills: 0,
    deaths: 0,
    assists: 0,
    goldEarned: 0,
    totalDamageDealtToChampions: 0,
    visionScore: 0,
    totalMinionsKilled: 0,
    neutralMinionsKilled: 0,
    firstBloodKill: false,
    firstBloodAssist: false,
    tripleKills: 0,
    quadraKills: 0,
    pentaKills: 0,
    win: false,
    ...overrides
  }
}

function createLcuGame(
  queueId: number,
  playerOverrides: ParticipantOverrides = {},
  gameCreation = NOW - 60 * 60 * 1000
): LcuOrSgpGameSummary {
  const puuids = ['p1', 'p2', 'p3', 'p4', 'p5']

  return {
    source: 'lcu',
    gameId: gameCreation,
    data: {
      queueId,
      gameCreation,
      gameDuration: 30 * 60,
      participantIdentities: puuids.map((puuid, index) => ({
        participantId: index + 1,
        player: { puuid }
      })),
      participants: puuids.map((_, index) => ({
        participantId: index + 1,
        teamId: 100,
        stats: participantStats(index === 0 ? playerOverrides : {})
      }))
    }
  } as unknown as LcuOrSgpGameSummary
}

function createSgpGame(
  queueId: number,
  playerOverrides: ParticipantOverrides = {},
  gameCreation = NOW - 60 * 60 * 1000
): LcuOrSgpGameSummary {
  const puuids = ['p1', 'p2', 'p3', 'p4', 'p5']

  return {
    source: 'sgp',
    gameId: gameCreation,
    data: {
      json: {
        queueId,
        gameCreation,
        gameDuration: 30 * 60,
        participants: puuids.map((puuid, index) => ({
          participantId: index + 1,
          puuid,
          teamId: 100,
          teamPosition: index === 4 ? 'UTILITY' : 'MIDDLE',
          ...participantStats(index === 0 ? playerOverrides : {})
        }))
      }
    }
  } as unknown as LcuOrSgpGameSummary
}

describe('horse rating scoring', () => {
  it.each([
    [180, true, 'S'],
    [150, true, 'A'],
    [125, true, 'B'],
    [105, true, 'C'],
    [95, true, 'D'],
    [94.99, true, 'E'],
    [94.99, false, 'F']
  ] as const)('maps score %s for ally=%s to grade %s', (score, isAlly, grade) => {
    expect(getHorseGrade(score, isAlly)).toBe(grade)
  })

  it('reads queueId from both LCU and SGP summaries', () => {
    expect(getGameQueueId(createLcuGame(420))).toBe(420)
    expect(getGameQueueId(createSgpGame(440))).toBe(440)
  })

  it('combines only LCU and SGP matches from the current queue', () => {
    const rating = calculateHorseRating(
      'p1',
      [
        createLcuGame(420, { kills: 10, deaths: 2, assists: 5, win: true }),
        createSgpGame(420, { kills: 2, deaths: 4, assists: 2, win: false }),
        createLcuGame(440, { kills: 30, deaths: 0, assists: 20, win: true })
      ],
      420,
      true,
      NOW
    )

    expect(rating).not.toBeNull()
    expect(rating?.matchCount).toBe(2)
    expect(rating?.averageKda).toBeCloseTo(4.25)
    expect(rating?.winRate).toBe(0.5)
  })

  it('does not fall back to another queue when the current queue has no matches', () => {
    expect(calculateHorseRating('p1', [createLcuGame(440)], 420, true, NOW)).toBeNull()
  })

  it('keeps the original 80/20 recent-versus-old weighting', () => {
    const recent = createLcuGame(420, {
      kills: 20,
      assists: 10,
      firstBloodKill: true,
      tripleKills: 1,
      quadraKills: 1,
      pentaKills: 1,
      goldEarned: 20_000,
      totalDamageDealtToChampions: 50_000,
      visionScore: 60,
      totalMinionsKilled: 300,
      win: true
    })
    const old = createLcuGame(420, {}, NOW - 6 * 60 * 60 * 1000)
    const recentRating = calculateHorseRating('p1', [recent], 420, true, NOW)
    const oldRating = calculateHorseRating('p1', [old], 420, true, NOW)
    const combinedRating = calculateHorseRating('p1', [recent, old], 420, true, NOW)

    expect(combinedRating?.score).toBeCloseTo(recentRating!.score * 0.8 + oldRating!.score * 0.2)
  })

  it('uses 牛马 for a low-scoring ally and 没有马 for a low-scoring enemy', () => {
    const lowScoreGame = createLcuGame(420)

    expect(calculateHorseRating('p5', [lowScoreGame], 420, true, NOW)?.grade).toBe('E')
    expect(calculateHorseRating('p5', [lowScoreGame], 420, false, NOW)?.grade).toBe('F')
  })
})
