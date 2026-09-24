const indexNames = (definition) => new Set((definition.indexes ?? []).map((index) => index.indexDescriptor));
const fieldsOf = (definition) => new Set(Object.keys(definition.validator?.fields ?? {}));

export function validateDataRegistry(schemaTables, registry) {
  const errors = [];
  const schemaNames = new Set(Object.keys(schemaTables));
  for (const name of schemaNames) if (!registry[name]) errors.push(`unregistered schema table: ${name}`);
  for (const name of Object.keys(registry)) if (!schemaNames.has(name)) errors.push(`stale registry entry: ${name}`);

  for (const [name, entry] of Object.entries(registry)) {
    const definition = schemaTables[name];
    if (!definition) continue;
    const fields = fieldsOf(definition);
    const indexes = indexNames(definition);
    if (entry.scope === "project" && name !== "oauthStates" && !fields.has("projectId") && entry.deletion.kind !== "account-parent") {
      errors.push(`${name}: project scope has no projectId or parent rule`);
    }
    if (fields.has("projectId") && entry.scope !== "project" && name !== "oauthStates") {
      errors.push(`${name}: projectId table is not project scoped`);
    }
    if (entry.scope !== "global" && entry.tenantField !== "_id" && !fields.has(entry.tenantField)) {
      errors.push(`${name}: tenant field ${entry.tenantField} is missing`);
    }
    const rule = entry.deletion;
    if (["project-cascade", "account-index", "organization-policy", "sole-owner"].includes(rule.kind)) {
      if (!indexes.has(rule.index)) errors.push(`${name}: deletion index ${rule.index} is missing`);
      if (!fields.has(rule.field)) errors.push(`${name}: deletion field ${rule.field} is missing`);
    }
    if (rule.kind === "organization-links") {
      if (!indexes.has(rule.agencyIndex) || !fields.has(rule.agencyField)) errors.push(`${name}: agency link deletion rule is invalid`);
      if (!indexes.has(rule.clientIndex) || !fields.has(rule.clientField)) errors.push(`${name}: client link deletion rule is invalid`);
    }
    if (rule.kind === "account-parent") {
      const parent = schemaTables[rule.parentTable];
      if (!parent) errors.push(`${name}: parent table ${rule.parentTable} is missing`);
      else if (!indexNames(parent).has(rule.parentIndex)) errors.push(`${name}: parent index ${rule.parentIndex} is missing`);
      if (!indexes.has(rule.childIndex)) errors.push(`${name}: child index ${rule.childIndex} is missing`);
      if (!fields.has(rule.childField)) errors.push(`${name}: child field ${rule.childField} is missing`);
    }
    if (/(credential|auth|oauth|token)/i.test(name) && entry.export === "included") {
      errors.push(`${name}: sensitive data cannot be included in exports`);
    }
    if ((entry.scope === "user" || entry.scope === "organization") && !entry.accountCleanup?.length) {
      errors.push(`${name}: account cleanup policy is missing`);
    }
    for (const cleanup of entry.accountCleanup ?? []) {
      if (cleanup.kind === "index") {
        if (!indexes.has(cleanup.index)) errors.push(`${name}: account cleanup index ${cleanup.index} is missing`);
        if (!fields.has(cleanup.field)) errors.push(`${name}: account cleanup field ${cleanup.field} is missing`);
      }
      if (cleanup.kind === "parent-children") {
        const parent = schemaTables[name];
        if (!parent || !indexNames(parent).has(cleanup.parentIndex)) errors.push(`${name}: account cleanup parent index ${cleanup.parentIndex} is missing`);
        for (const child of cleanup.children) {
          const childTable = schemaTables[child.table];
          if (!childTable || !indexNames(childTable).has(child.index)) errors.push(`${name}: account cleanup child index ${child.table}.${child.index} is missing`);
          else if (!fieldsOf(childTable).has(child.field)) errors.push(`${name}: account cleanup child field ${child.table}.${child.field} is missing`);
        }
      }
      if (cleanup.kind === "export-jobs") {
        const parent = schemaTables.privacyJobs;
        if (!parent || !indexNames(parent).has(cleanup.parentIndex)) errors.push(`${name}: export cleanup parent index ${cleanup.parentIndex} is missing`);
        if (!indexes.has(cleanup.childIndex)) errors.push(`${name}: export cleanup child index ${cleanup.childIndex} is missing`);
        if (!fields.has(cleanup.childField)) errors.push(`${name}: export cleanup child field ${cleanup.childField} is missing`);
      }
    }
  }
  return errors;
}
