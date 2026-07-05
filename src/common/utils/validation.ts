import { z } from 'zod';

export function parseWithSchema<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw result.error;
  }

  return result.data;
}

export const trimmedString = z.string().trim().min(1);
export const optionalTrimmedString = trimmedString.optional();
export const emailValue = z.email().trim().toLowerCase();
export const resourceIdValue = trimmedString;
export const optionalUrlValue = z.url().trim().optional();
export const paginationPageValue = z.coerce.number().int().min(1).default(1);
export const paginationLimitValue = z.coerce.number().int().min(1).max(100).default(20);
export const booleanQueryValue = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');
export const passwordValue = z
  .string()
  .min(8, 'Password must be at least 8 characters long.')
  .max(100);
