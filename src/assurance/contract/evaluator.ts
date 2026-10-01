import { Contract, EvidenceSnapshot, Validity } from '../domain/types';

export function evaluateContract(contract: Contract, evidence: EvidenceSnapshot): Record<string, Validity> {
  const results: Record<string, Validity> = {};
  for (const a of contract.assumptions) {
    results[a.id] = a.check(evidence);
  }
  return results;
}
