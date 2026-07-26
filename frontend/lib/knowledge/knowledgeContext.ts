import { Brand } from "@/types/brand";

export interface KnowledgePack {
  facts: string[];
  competitors: string[];
  trends: string[];
  references: string[];
}

export function buildKnowledgeContext(
  brand: Brand,
  knowledge: KnowledgePack
): string {
  return `
KNOWN FACTS

${knowledge.facts.join("\n")}

COMPETITORS

${knowledge.competitors.join("\n")}

CURRENT TRENDS

${knowledge.trends.join("\n")}

REFERENCES

${knowledge.references.join("\n")}
`;
}