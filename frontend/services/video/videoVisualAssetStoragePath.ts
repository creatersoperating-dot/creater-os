export type AuthoritativeVisualFormat = "svg" | "png";

export function videoVisualAssetStoragePath(
  userId: string,
  brandId: string,
  projectId: string,
  generationId: string,
  sceneNumber: number,
  format: AuthoritativeVisualFormat,
): string {
  return `${userId}/${brandId}/${projectId}/${generationId}/scenes/${sceneNumber}.${format}`;
}
