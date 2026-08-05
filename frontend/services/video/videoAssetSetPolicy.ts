export interface ActiveSceneAssetExpectation {
  sceneId: string;
  sceneNumber: number;
  sourceHash: string;
}

export interface AuthoritativeSceneAssetCandidate {
  sceneId: string;
  sceneNumber: number;
  planId: string;
  planVersion: number;
  sourceHash: string;
  ready: boolean;
  metadataValid: boolean;
  objectValid: boolean;
}

export function isExactAuthoritativeAssetSet(
  scenes: readonly ActiveSceneAssetExpectation[],
  assets: readonly AuthoritativeSceneAssetCandidate[],
  planId: string,
  planVersion: number,
): boolean {
  if (scenes.length === 0 || assets.length !== scenes.length) return false;
  const assetSceneIds = new Set<string>();
  const assetSceneNumbers = new Set<number>();
  for (const asset of assets) {
    const scene = scenes.find((entry) => entry.sceneId === asset.sceneId && entry.sceneNumber === asset.sceneNumber);
    if (!scene || assetSceneIds.has(asset.sceneId) || assetSceneNumbers.has(asset.sceneNumber)
      || asset.planId !== planId || asset.planVersion !== planVersion || asset.sourceHash !== scene.sourceHash
      || !asset.ready || !asset.metadataValid || !asset.objectValid) return false;
    assetSceneIds.add(asset.sceneId); assetSceneNumbers.add(asset.sceneNumber);
  }
  return scenes.every((scene) => assetSceneIds.has(scene.sceneId) && assetSceneNumbers.has(scene.sceneNumber));
}
