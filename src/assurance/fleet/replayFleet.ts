import { InMemoryFleetAggregator, RolloutInfo } from './FleetAggregator';

export const REPLAY_ROBOT_ID = 'r2b-01';
export const REPLAY_FLEET_ID = 'r2b_datacenter';
export const NOT_IN_DATASET = 'Not in dataset';

/**
 * Fleet aggregator backed by the single real robot in the NVIDIA r2b dataset.
 * The dataset contains one robot configuration and no fleet/rollout/firmware
 * data, so rollout fields are explicitly "Not in dataset".
 */
export function createReplayFleet(): InMemoryFleetAggregator {
  const rollout: RolloutInfo = {
    from_version: NOT_IN_DATASET,
    to_version: NOT_IN_DATASET,
    updated: [],
    pending: [],
    halted: false,
    anomaly_flagged: false,
    flag_reason: null
  };
  const agg = new InMemoryFleetAggregator(REPLAY_FLEET_ID, rollout);
  agg.registerRobot(REPLAY_ROBOT_ID, 'r2b robot', NOT_IN_DATASET);
  return agg;
}
