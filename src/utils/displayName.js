/**
 * Human-ish display name from a service/app id.
 * Does not invent product branding (academicx → Academicx, payments-api → Payments-api).
 */
function formatDisplayName(name) {
  if (name == null || name === '') return name;
  const s = String(name);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { formatDisplayName };
