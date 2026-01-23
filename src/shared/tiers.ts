export type ProductiveTier =
  | 'unproductive'
  | 'productive'
  | 'highly_productive';

export function getProductiveTier(
  customerCount: number,
  businessCount: number,
): ProductiveTier {
  if (customerCount >= 4 && businessCount >= 4) {
    return 'highly_productive';
  }
  if (customerCount >= 2 && businessCount >= 2) {
    return 'productive';
  }
  return 'unproductive';
}

export function isQualified(tier: ProductiveTier): boolean {
  return tier === 'productive' || tier === 'highly_productive';
}
