'use strict';

/**
 * Watchdog EWS V7.1 — pure logic for the Human Review Edit Form
 * (Dashboard/dashboard.js's "Edit Draft" control). Deliberately has zero
 * DOM dependency so it can be unit-tested directly under Node (see
 * Dashboard/test/run_edit_form_logic.js) and loaded unmodified in the
 * browser via a plain <script> tag — same dependency-free pattern
 * already used by Dashboard/repository.js. The field list and the
 * material-fields set here MUST stay in sync with the SQL function
 * edit_signal_intelligence_analysis_draft() (see the V7.1 section of
 * supabase/migrations/20260728000000_watchdog_v7_local_policy_intelligence.sql)
 * — this file mirrors that function's allowlist and material-field rule,
 * it is not an independent source of truth.
 */

// One row per editable field: { key, label, kind, options? }
// kind: 'text' (single-line-ish textarea), 'list' (array of strings),
// 'factList' (array of {statement, evidence_ids}), 'inferenceList' (array
// of {statement, basis, confidence, evidence_ids}), 'select'.
const EDITABLE_ANALYSIS_FIELDS = [
  { key: 'executive_summary', label: 'Executive Summary', kind: 'text' },
  { key: 'confirmed_facts', label: 'Confirmed Facts', kind: 'factList' },
  { key: 'inferences', label: 'Inferences', kind: 'inferenceList' }, // usage_metadata-housed
  { key: 'unresolved_facts', label: 'Unresolved Questions', kind: 'list' },
  { key: 'practical_consequences', label: 'Practical Consequences', kind: 'text' },
  { key: 'organizational_relevance', label: 'Organizational Relevance', kind: 'text' },
  { key: 'geographic_significance', label: 'Geographic Significance', kind: 'text' },
  { key: 'materiality_level', label: 'Materiality', kind: 'select', options: ['High', 'Medium', 'Low', 'Unclear'] },
  { key: 'materiality_rationale', label: 'Materiality Rationale', kind: 'text' },
  { key: 'evidence_quality', label: 'Evidence Quality', kind: 'select', options: ['High', 'Medium', 'Low', 'Unclear'] },
  { key: 'evidence_gaps', label: 'Evidence Gaps', kind: 'text' },
  {
    key: 'position_pathway', label: 'Position Pathway', kind: 'select', material: true,
    options: [
      'Directly governed by an adopted position',
      'Reasonably derived from established principles',
      'Governed by a locally adopted position',
      'Judgment required through governance',
      'No organizational position established',
    ],
  },
  { key: 'potential_applicable_position_note', label: 'Position Rationale', kind: 'text', material: true },
  { key: 'intelligence_priority', label: 'Proposed Priority', kind: 'select', material: true, options: ['High', 'Medium', 'Monitor', 'Unclear'] },
  { key: 'priority_rationale', label: 'Priority Rationale', kind: 'text', material: true },
  { key: 'proposed_response_options', label: 'Response Options', kind: 'list', material: true },
  { key: 'recommended_governance_path', label: 'Governance Route', kind: 'text', material: true },
  { key: 'warnings', label: 'Warnings', kind: 'list' }, // usage_metadata-housed
  { key: 'analyst_note', label: 'Analyst Note', kind: 'text' }, // usage_metadata-housed
];

// Mirrors the SQL function's v_material_fields — must stay a superset (or
// exact match) of every field above marked material: true.
const MATERIAL_FIELD_KEYS = [
  'position_pathway', 'potential_applicable_position_note', 'position_confidence',
  'intelligence_priority', 'priority_rationale', 'urgency',
  'proposed_response_options', 'recommended_governance_path',
  'opportunity_for_influence', 'relationship_considerations',
];

// usage_metadata-housed fields (no dedicated DB column — see
// docs/watchdog-chatgpt-packet-format.md's field-mapping table).
const USAGE_METADATA_FIELD_KEYS = ['inferences', 'warnings', 'analyst_note'];

function readFieldValue(analysis, key) {
  if (!analysis) return undefined;
  if (USAGE_METADATA_FIELD_KEYS.includes(key)) {
    const meta = analysis.usage_metadata || {};
    return meta[key];
  }
  return analysis[key];
}

function jsonEqual(a, b) {
  return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
}

/**
 * Compares "current form values" (a plain object keyed by field key) to
 * the original analysis, and returns only the fields that actually
 * changed — never a bulk payload of every field, so an untouched field
 * can never accidentally be flagged as a "material change" just because
 * it was present in the request.
 */
function diffAnalysisUpdates(originalAnalysis, currentValues) {
  const updates = {};
  for (const field of EDITABLE_ANALYSIS_FIELDS) {
    if (!(field.key in currentValues)) continue;
    const before = readFieldValue(originalAnalysis, field.key);
    const after = currentValues[field.key];
    if (!jsonEqual(before, after)) {
      updates[field.key] = after;
    }
  }
  return updates;
}

/** Pure: does this set of changed keys touch Position, Priority, or Response? */
function requiresReviewNote(updates) {
  return Object.keys(updates).some((k) => MATERIAL_FIELD_KEYS.includes(k));
}

/** List-field row <-> plain-string conversion, for 'list' kind fields. */
function listFieldToRows(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v : (v && (v.text || v.option || v.statement)) || ''));
}
function rowsToListField(rows) {
  return (rows || []).map((r) => String(r || '').trim()).filter((r) => r.length > 0);
}

/**
 * Fact/inference-list row <-> object conversion. Preserves evidence_ids
 * (and, for inferences, basis/confidence) from the ORIGINAL array by
 * index when a row's text is edited in place; a newly-added row starts
 * with no evidence linkage, since the UI never invents a citation.
 */
function factListToRows(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => ({
    statement: typeof v === 'string' ? v : (v && v.statement) || '',
    evidence_ids: (v && Array.isArray(v.evidence_ids)) ? v.evidence_ids : [],
  }));
}
function rowsToFactList(rows) {
  return (rows || [])
    .filter((r) => r && String(r.statement || '').trim().length > 0)
    .map((r) => ({ statement: String(r.statement).trim(), evidence_ids: Array.isArray(r.evidence_ids) ? r.evidence_ids : [] }));
}

function inferenceListToRows(value) {
  if (!Array.isArray(value)) return [];
  return value.map((v) => ({
    statement: (v && v.statement) || '',
    basis: (v && v.basis) || '',
    confidence: (v && v.confidence) || 'medium',
    evidence_ids: (v && Array.isArray(v.evidence_ids)) ? v.evidence_ids : [],
  }));
}
function rowsToInferenceList(rows) {
  return (rows || [])
    .filter((r) => r && String(r.statement || '').trim().length > 0)
    .map((r) => ({
      statement: String(r.statement).trim(),
      basis: String(r.basis || '').trim(),
      confidence: ['low', 'medium', 'high'].includes(r.confidence) ? r.confidence : 'medium',
      evidence_ids: Array.isArray(r.evidence_ids) ? r.evidence_ids : [],
    }));
}

const api = {
  EDITABLE_ANALYSIS_FIELDS,
  MATERIAL_FIELD_KEYS,
  USAGE_METADATA_FIELD_KEYS,
  readFieldValue,
  diffAnalysisUpdates,
  requiresReviewNote,
  listFieldToRows,
  rowsToListField,
  factListToRows,
  rowsToFactList,
  inferenceListToRows,
  rowsToInferenceList,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof window !== 'undefined') {
  window.WatchdogEditFormLogic = api;
}
