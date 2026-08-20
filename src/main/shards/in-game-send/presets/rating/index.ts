import type {
  InGameSendPresetTarget,
  InGameSendRatingPresetOptions
} from '@shared/shards/in-game-send'
import { getInGameSendRatingPresetShortcutTargetId } from '@shared/shards/in-game-send'

import type { InGameSendMainContext } from '../../context'
import { createPresetTeams, selectedPlayersByPuuids } from '../helpers'
import { presetT } from '../i18n'
import { countSelectedChampionIds, playerDisplayName } from '../name-display'
import type { InGameSendPresetContext, InGameSendPresetTeam } from '../types'
import { calculateHorseRating } from './scoring'

export type InGameSendRatingPresetLineOptions = Pick<
  InGameSendRatingPresetOptions,
  'nameDisplayStrategy'
> & {
  selectedPuuids: string[]
}

export const getRatingPresetShortcutTargetId = getInGameSendRatingPresetShortcutTargetId

export function createRatingPresetLineOptions(
  mainContext: InGameSendMainContext
): InGameSendRatingPresetLineOptions {
  const options = mainContext.settings.ratingPresetOptions

  return {
    selectedPuuids: mainContext.state.ratingPuuids,
    nameDisplayStrategy: options.nameDisplayStrategy
  }
}

function resolveIsAlly(
  context: InGameSendPresetContext,
  team: InGameSendPresetTeam,
  teams: InGameSendPresetTeam[]
) {
  const selfPuuid = context.mainContext.leagueClient.data.summoner.me?.puuid
  const selfTeam = selfPuuid
    ? teams.find((candidate) => candidate.players.some((player) => player.puuid === selfPuuid))
    : null

  if (selfTeam) {
    return selfTeam.teamIdentifier === team.teamIdentifier
  }

  if (context.target !== 'all') {
    return context.target === 'friendly'
  }

  return teams[0]?.teamIdentifier === team.teamIdentifier
}

function currentQueueId(context: InGameSendPresetContext) {
  const queueId = context.mainContext.ongoingGame.state.queryStage.gameInfo?.queueId

  return typeof queueId === 'number' && Number.isFinite(queueId) && queueId >= 0 ? queueId : null
}

export function buildRatingPresetLines(
  context: InGameSendPresetContext,
  options: InGameSendRatingPresetLineOptions
) {
  const teams = createPresetTeams(context)
  const selectedPlayers = selectedPlayersByPuuids(context, options.selectedPuuids, teams)
  const selectedChampionIdCounts = countSelectedChampionIds(
    selectedPlayers.map(({ player }) => player)
  )
  const queueId = currentQueueId(context)
  const phase = context.mainContext.ongoingGame.state.queryStage.phase
  const useCompactPrecision = phase === 'champ-select' || phase === 'lobby'

  return selectedPlayers.map(({ team, player }) => {
    const name = playerDisplayName(
      context,
      player,
      options.nameDisplayStrategy,
      selectedChampionIdCounts
    )

    if (queueId === null) {
      return presetT('rating.noCurrentQueue', { name })
    }

    const matchHistory =
      context.mainContext.ongoingGame.state.matchHistory[player.puuid]?.data ?? []
    const rating = calculateHorseRating(
      player.puuid,
      matchHistory,
      queueId,
      resolveIsAlly(context, team, teams)
    )

    if (!rating) {
      return presetT('rating.noCurrentQueueMatches', { name })
    }

    return presetT('rating.line', {
      grade: presetT(`rating.grades.${rating.grade}`),
      name,
      score: rating.score.toFixed(useCompactPrecision ? 0 : 1),
      count: rating.matchCount,
      kda: rating.averageKda.toFixed(useCompactPrecision ? 1 : 2),
      winRate: (rating.winRate * 100).toFixed(0)
    })
  })
}

export function buildRatingPresetLinesFromMainContext(
  mainContext: InGameSendMainContext,
  target: InGameSendPresetTarget
) {
  return buildRatingPresetLines(
    {
      target,
      mainContext
    },
    createRatingPresetLineOptions(mainContext)
  )
}
