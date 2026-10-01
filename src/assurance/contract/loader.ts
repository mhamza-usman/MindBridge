import { Contract, Assumption, EvidenceSnapshot, Validity } from '../domain/types';

export interface ContractDef {
  mission: string;
  version: string;
  assumptions: Record<string, {
    label: string;
    max?: number;
    min?: number;
    equals?: boolean | string | number;
  }>;
}

export function buildAssumption(id: string, def: any): Assumption {
  let limitStr = '';
  if (def.max !== undefined) limitStr = `<= ${def.max}`;
  else if (def.min !== undefined) limitStr = `>= ${def.min}`;
  else if (def.equals !== undefined) limitStr = `== ${def.equals}`;
  else limitStr = 'custom';

  return {
    id,
    label: def.label || id,
    limit: limitStr,
    check: (e: EvidenceSnapshot): Validity => {
      const item = e.items[id];
      if (!item) return 'unk';
      
      const val = parseFloat(item.value);
      if (isNaN(val) && typeof item.value === 'string') {
        // boolean or string equals
        if (def.equals !== undefined) {
           const bVal = item.value === 'true' ? true : item.value === 'false' ? false : item.value;
           return bVal === def.equals ? 'ok' : 'bad';
        }
        return 'unk';
      }

      if (def.max !== undefined && val > def.max) return 'bad';
      if (def.min !== undefined && val < def.min) return 'bad';
      if (def.equals !== undefined && val !== def.equals) return 'bad';

      return 'ok';
    }
  };
}

export function loadContract(def: ContractDef): Contract {
  const assumptions: Assumption[] = [];
  for (const [id, aDef] of Object.entries(def.assumptions)) {
    assumptions.push(buildAssumption(id, aDef));
  }
  return {
    mission: def.mission,
    version: def.version,
    assumptions
  };
}

export const defaultContractDef: ContractDef = {
  mission: 'warehouse_navigation',
  version: '1.0',
  assumptions: {
    camera_age_ms: { label: 'Camera freshness', max: 200 },
    lidar_age_ms: { label: 'LiDAR freshness', max: 200 },
    tf_age_ms: { label: 'TF age', max: 500 },
    localization_std_m: { label: 'Localization std dev', max: 0.05 },
    battery_reserve_pct: { label: 'Battery reserve', min: 20 },
    calibration_valid: { label: 'Calibration valid', equals: true },
    sensors_agree: { label: 'Camera and LiDAR agree', equals: true }
  }
};

export function getDefaultContract(): Contract {
  return loadContract(defaultContractDef);
}
