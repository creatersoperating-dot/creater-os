export interface CreatorScript {
  id: string;
  brandId: string;
  title: string;
  topic: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export type CreateScriptInput = Pick<
  CreatorScript,
  "brandId" | "title" | "topic" | "content"
>;

export type UpdateScriptInput = Partial<
  Pick<CreatorScript, "title" | "topic" | "content">
>;
