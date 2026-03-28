import { z } from "zod";
import {
  AllowFromListSchema,
  buildCatchallMultiAccountChannelSchema,
  DmPolicySchema,
} from "../runtime-api.js";

const weixinAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().optional(),
  authFile: z.string().optional(),
  syncBufFile: z.string().optional(),
  pollIntervalMs: z.number().int().positive().optional(),
  routeTag: z.string().optional(),
  botType: z.string().optional(),
  dmPolicy: DmPolicySchema.optional(),
  allowFrom: AllowFromListSchema,
  defaultTo: z.string().optional(),
});

export const WeixinConfigSchema = buildCatchallMultiAccountChannelSchema(weixinAccountSchema);
