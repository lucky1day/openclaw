import { formatBonjourError } from "./bonjour-errors.js";

const CIAO_CANCELLATION_MESSAGE_RE = /^CIAO (?:ANNOUNCEMENT|PROBING) CANCELLED\b/u;
const CIAO_INTERFACE_ASSERTION_MESSAGE_RE =
  /REACHED ILLEGAL STATE!?\s+IPV4 ADDRESS CHANGE FROM DEFINED TO UNDEFINED!?/u;
const CIAO_NETMASK_ASSERTION_MESSAGE_RE =
  /IP ADDRESS VERSION MUST MATCH\.\s+NETMASK CANNOT HAVE A VERSION DIFFERENT FROM THE ADDRESS!?/u;
const CIAO_STACK_HINT_RE = /(?:@HOMEBRIDGE\/CIAO|\/CIAO\/|MDNSSERVER|DOMAIN-FORMATTER)/u;

export type CiaoUnhandledRejectionClassification =
  | { kind: "cancellation"; formatted: string }
  | { kind: "interface-assertion"; formatted: string };

export type CiaoUncaughtExceptionClassification = {
  kind: "netmask-assertion";
  formatted: string;
};

function readErrorStack(reason: unknown): string {
  if (!reason || typeof reason !== "object") {
    return "";
  }
  const stack = (reason as { stack?: unknown }).stack;
  return typeof stack === "string" ? stack : "";
}

export function classifyCiaoUnhandledRejection(
  reason: unknown,
): CiaoUnhandledRejectionClassification | null {
  const formatted = formatBonjourError(reason);
  const message = formatted.toUpperCase();
  if (CIAO_CANCELLATION_MESSAGE_RE.test(message)) {
    return { kind: "cancellation", formatted };
  }
  if (CIAO_INTERFACE_ASSERTION_MESSAGE_RE.test(message)) {
    return { kind: "interface-assertion", formatted };
  }
  return null;
}

export function classifyCiaoUncaughtException(
  reason: unknown,
): CiaoUncaughtExceptionClassification | null {
  const formatted = formatBonjourError(reason);
  const message = formatted.toUpperCase();
  const stack = readErrorStack(reason).toUpperCase();
  if (CIAO_NETMASK_ASSERTION_MESSAGE_RE.test(message) && CIAO_STACK_HINT_RE.test(stack)) {
    return { kind: "netmask-assertion", formatted };
  }
  return null;
}

export function ignoreCiaoUnhandledRejection(reason: unknown): boolean {
  return classifyCiaoUnhandledRejection(reason) !== null;
}

export function ignoreCiaoUncaughtException(reason: unknown): boolean {
  return classifyCiaoUncaughtException(reason) !== null;
}
