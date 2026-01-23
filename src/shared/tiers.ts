export type ProductiveTier =
  | 'unproductive'
  | 'productive'
  | 'highly_productive';

export function getProductiveTier(
  customerCount: number,
  businessCount: number,
): ProductiveTier {
  if (customerCount >= 5 && businessCount >= 5) {
    return 'highly_productive';
  }
  if (customerCount >= 3 && businessCount >= 3) {
    return 'productive';
  }
  return 'unproductive';
}

export function isQualified(tier: ProductiveTier): boolean {
  return tier === 'productive' || tier === 'highly_productive';
}
