import type { ClaimsDsl, PolicyExpression } from '@microsoft/rayfin-core';

type ProcessLike = { env?: Record<string, string | undefined> };

const environment = (globalThis as { process?: ProcessLike }).process?.env;

function configuredList(name: string): string[] {
  return environment?.[name]
  ?.split(',')
  .map((subject) => subject.trim())
  .filter(Boolean) ?? [];
}

const governanceReaderSubjects = configuredList('ONELENS_GOVERNANCE_READER_SUBJECTS');
const governanceReaderEmails = configuredList('ONELENS_GOVERNANCE_READER_EMAILS');

if (governanceReaderSubjects.length === 0 && governanceReaderEmails.length === 0) {
  throw new Error(
    'ONELENS_GOVERNANCE_READER_EMAILS or ONELENS_GOVERNANCE_READER_SUBJECTS is required when generating the Rayfin data configuration.',
  );
}

/** Restrict governance data to explicitly configured Rayfin identities. */
export function governanceReaderPolicy(claims: ClaimsDsl): PolicyExpression {
  const policies = [
    ...governanceReaderSubjects.map((subject) => claims.sub.eq(subject)),
    ...governanceReaderEmails.map((email) => claims.email.eq(email)),
  ];
  const [firstPolicy, ...remainingPolicies] = policies;
  let policy = firstPolicy;
  for (const additionalPolicy of remainingPolicies) policy = policy.or(additionalPolicy);
  return policy;
}