import { Contract, EvidenceSnapshot, ContractCheckResult } from '../domain/types';

/**
 * Evaluate every contract assumption that exists in the dataset.
 * Assumptions flagged `inDataset: false` are skipped (the UI renders them as
 * "Not in dataset"). A check whose evidence input is missing returns status
 * 'unk' — never a pass or fail.
 */
export function evaluateContract(contract: Contract, evidence: EvidenceSnapshot): Record<string, ContractCheckResult> {
  const results: Record<string, ContractCheckResult> = {};
  for (const a of contract.assumptions) {
    if (a.inDataset === false) continue;
    const item = evidence.items[a.id];
    results[a.id] = {
      label: a.label,
      limit: a.limit,
      status: item ? a.check(evidence) : 'unk',
      value: item ? item.value : 'Not in dataset'
    };
  }
  return results;
}
