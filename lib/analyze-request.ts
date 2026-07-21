import { z } from "zod";
import { toPublicUrl } from "./source.ts";
import type { AnalyzeRequest } from "./types.ts";

export const analyzeRequestSchema = z
  .object({
    urls: z
      .array(z.string().url())
      .min(2)
      .max(8)
      .refine(
        (urls) => new Set(urls).size === urls.length,
        "Product URLs must be unique",
      )
      .superRefine((urls, context) => {
        const normalized = new Set<string>();
        urls.forEach((url, index) => {
          try {
            const publicUrl = toPublicUrl(url).toString();
            if (normalized.has(publicUrl)) {
              context.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Product URLs must be unique",
                path: [index],
              });
            }
            normalized.add(publicUrl);
          } catch {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Unsafe product URL",
              path: [index],
            });
          }
        });
      }),
    context: z.string().trim().min(10).max(2_000),
    criteria: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(80),
            label: z.string().trim().min(1).max(80),
            hint: z.string().trim().max(200),
            weight: z.number().min(0).max(100),
          })
          .strict(),
      )
      .min(2)
      .max(8)
      .refine(
        (criteria) =>
          new Set(criteria.map((criterion) => criterion.key)).size ===
          criteria.length,
        "Criterion keys must be unique",
      ),
    locale: z.enum(["zh-CN", "en"]).default("zh-CN"),
  })
  .strict();

export function parseAnalyzeRequest(input: unknown): AnalyzeRequest {
  return analyzeRequestSchema.parse(input);
}
