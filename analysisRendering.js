// Watchdog EWS V8 — analysisRendering.js
//
// Pure, DOM-free logic correcting the documented V7.1 Analysis-tab
// rendering defects (docs/watchdog-manual-intelligence-pilot.md's
// "Known baseline interface findings"). dashboard.js calls these
// functions to decide WHAT to render; it still owns all actual DOM
// writes. Same testability split as Dashboard/editFormLogic.js.
//
// Every function here is read-only with respect to the analysis object
// it's given — none of this ever mutates or persists anything, so it
// cannot touch the preserved V7.1 baseline row
// (signal_intelligence_analyses.id e3ec122a-f750-4a7d-ad5f-f558898eb24c)
// no matter how it's called.
//
// Background on *why* these fixes are safe without a schema migration:
// every manual-pilot import stores the ENTIRE original ChatGPT JSON
// response verbatim at usage_metadata.raw_imported_response (see
// intelligence/manualImport.js) — the flattened, lossy columns
// (evidence_gaps, position_pathway, practical_consequences) exist
// alongside that untouched original, not instead of it. See
// docs/watchdog-chatgpt-packet-format.md for the full response shape.

(function (global) {
  'use strict';

  function hasVal(v) {
    return v !== null && v !== undefined && String(v).trim() !== '';
  }

  function rawImportedResponse(analysis) {
    return (analysis && analysis.usage_metadata && analysis.usage_metadata.raw_imported_response) || null;
  }

  /* ── Defect: Confirmed Facts rendered as empty bullets ────────────
     confirmed_facts entries are {statement, evidence_ids} objects — the
     old renderer read a nonexistent .text/.question property instead. */
  function factStatement(fact) {
    if (typeof fact === 'string') return fact;
    if (fact && typeof fact === 'object') return fact.statement || '';
    return '';
  }

  function factEvidenceIds(fact) {
    if (fact && typeof fact === 'object' && Array.isArray(fact.evidence_ids)) return fact.evidence_ids.filter(hasVal);
    return [];
  }

  // Used for both confirmed_facts ({statement, evidence_ids} objects)
  // and unresolved_facts (plain strings) — factStatement() handles both
  // shapes correctly, so one function covers both call sites.
  function confirmedFactEntries(analysis) {
    const list = Array.isArray(analysis && analysis.confirmed_facts) ? analysis.confirmed_facts : [];
    return list
      .map((f) => ({ statement: factStatement(f), evidenceIds: factEvidenceIds(f) }))
      .filter((e) => hasVal(e.statement));
  }

  function unresolvedFactEntries(analysis) {
    const list = Array.isArray(analysis && analysis.unresolved_facts) ? analysis.unresolved_facts : [];
    return list.map((f) => factStatement(f)).filter(hasVal);
  }

  /* ── Defect: evidence gaps flattened into one dense paragraph ──────
     Prefers the original structured evidence_quality.gaps/.contradictions
     arrays from raw_imported_response when present (kept distinct —
     contradictions are a stronger signal than an ordinary gap and should
     never look identical to one). Falls back to splitting the stored
     flattened string on its own join separator ('; ', see
     intelligence/manualImportSchema.js) only for rows saved before this
     structuring existed or lacking usage_metadata entirely. */
  function evidenceGapEntries(analysis) {
    const raw = rawImportedResponse(analysis);
    const eq = raw && raw.evidence_quality;
    if (eq && (Array.isArray(eq.gaps) || Array.isArray(eq.contradictions))) {
      const gaps = (eq.gaps || []).filter(hasVal).map((text) => ({ type: 'gap', text }));
      const contradictions = (eq.contradictions || []).filter(hasVal).map((text) => ({ type: 'contradiction', text }));
      return { entries: [...gaps, ...contradictions], structured: true };
    }
    const flat = analysis && analysis.evidence_gaps;
    if (typeof flat === 'string' && flat.trim()) {
      const entries = flat.split(';').map((s) => s.trim()).filter(Boolean).map((text) => ({ type: 'gap', text }));
      return { entries, structured: false };
    }
    return { entries: [], structured: false };
  }

  /* ── Defect: Practical Consequences over-compressed / not structured ──
     The response contract's practical_consequences is an array (see
     docs/watchdog-chatgpt-packet-format.md); the stored column flattens
     it to a joined string. Prefer the original array when available. */
  function practicalConsequenceEntries(analysis) {
    const raw = rawImportedResponse(analysis);
    if (raw && Array.isArray(raw.practical_consequences)) {
      const entries = raw.practical_consequences.filter(hasVal);
      if (entries.length) return { entries, structured: true };
    }
    const flat = analysis && analysis.practical_consequences;
    return hasVal(flat) ? { entries: [String(flat).trim()], structured: false } : { entries: [], structured: false };
  }

  /* ── Defect: insufficient_evidence renders identically to
     "No organizational position established" ──────────────────────
     Both response tokens deliberately map to the SAME canonical
     position_pathway column value (intelligence/manualSchema.js's
     POSITION_PATHWAY_MAP — five doctrine pathways, not six; this is a
     genuine doctrine decision, not a bug in that file). The distinction
     the review still needs is recoverable, though: the original
     lowercase token ChatGPT actually returned survives untouched at
     raw_imported_response.position.pathway. This function prefers that
     original token for display; only a row with no usage_metadata at
     all (or a pre-manual-pilot / directly-AI-generated row with a
     differently-shaped usage_metadata) falls back to the flattened
     doctrine sentence, unable to distinguish the two. */
  const POSITION_PATHWAY_DISPLAY = {
    directly_governed: { label: 'Directly Governed', description: 'Directly governed by an adopted organizational position.' },
    reasonably_derived: { label: 'Reasonably Derived', description: 'Reasonably derived from established organizational principles.' },
    locally_adopted: { label: 'Locally Adopted', description: 'Governed by a locally adopted position.' },
    governance_required: { label: 'Governance Required', description: 'Judgment required through governance before a position applies.' },
    no_position_established: { label: 'No Position Established', description: 'No organizational position currently applies to this matter.' },
    insufficient_evidence: { label: 'Insufficient Evidence', description: 'Not enough evidence is available yet to determine whether an organizational position applies.' },
  };

  function positionPathwayDisplay(analysis) {
    const raw = rawImportedResponse(analysis);
    const rawToken = raw && raw.position && typeof raw.position.pathway === 'string'
      ? raw.position.pathway.toLowerCase().trim()
      : null;
    if (rawToken && POSITION_PATHWAY_DISPLAY[rawToken]) {
      return { ...POSITION_PATHWAY_DISPLAY[rawToken], token: rawToken, source: 'raw_token' };
    }
    const flat = analysis && analysis.position_pathway;
    if (hasVal(flat)) return { label: flat, description: '', token: null, source: 'flattened_fallback' };
    return { label: 'Not addressed', description: '', token: null, source: 'none' };
  }

  /* ── Defect: Executive Summary visually truncated ─────────────────
     No data-shape fix needed — the old renderer reused the card
     snippet's 2-line-clamp CSS class for a full analytical paragraph.
     This function just hands back the full text; dashboard.js pairs it
     with a non-clamped CSS class (see dashboard.css's
     .analysis-summary). */
  function executiveSummaryText(analysis) {
    return hasVal(analysis && analysis.executive_summary) ? analysis.executive_summary : '';
  }

  /* ── Defect: "Why It Matters — Not addressed" fallback ────────────
     There is no why_it_matters column with real content in the current
     schema (it is never populated by the manual-pilot import path) —
     the old renderer's fallback text was therefore shown for every
     analysis ever saved. Per the ticket: build "Why This Matters" from
     EXISTING stored fields only — no new prose generated at runtime, no
     new database field invented, and no organization name hardcoded
     into product-shell language (Watchdog EWS is an independent
     product; the operating organization is not the product identity). */
  function whyThisMattersEntries(analysis) {
    const entries = [];
    if (hasVal(analysis && analysis.organizational_relevance)) {
      entries.push({ label: 'Organizational Relevance', text: analysis.organizational_relevance });
    }
    if (hasVal(analysis && analysis.practical_consequences)) {
      entries.push({ label: 'Practical Consequences', text: analysis.practical_consequences });
    }
    if (hasVal(analysis && analysis.geographic_significance)) {
      entries.push({ label: 'Geographic Significance', text: analysis.geographic_significance });
    }
    return entries;
  }

  /* ── Missing: no prominent Recommended Next Step ──────────────────
     response.preferred_option is part of the response contract (see
     docs/watchdog-chatgpt-packet-format.md) but has no dedicated column
     — only the array proposed_response_options is persisted directly.
     The single preferred option survives at
     raw_imported_response.response.preferred_option for every row saved
     through the manual pilot. Never invents a recommendation: a row
     without this value honestly reports that none was recorded. */
  function recommendedNextStep(analysis) {
    const raw = rawImportedResponse(analysis);
    const preferred = raw && raw.response && typeof raw.response.preferred_option === 'string'
      ? raw.response.preferred_option.trim()
      : '';
    if (preferred) return { text: preferred, recorded: true };
    return { text: 'No recommendation was recorded for this analysis.', recorded: false };
  }

  /* ── Governance (Part 7H): show whether governance is required and the
     recommended route, without ever presenting a proposal as an approved
     decision. governance.required/approval_needed_from have no dedicated
     columns — only recommended_governance_path (governance.recommended_route)
     is persisted directly — so the boolean/approval-list only exist for
     rows carrying raw_imported_response. */
  function governanceInfo(analysis) {
    const raw = rawImportedResponse(analysis);
    const gov = raw && raw.governance;
    return {
      required: gov && typeof gov.required === 'boolean' ? gov.required : null,
      recommendedRoute: hasVal(analysis && analysis.recommended_governance_path) ? analysis.recommended_governance_path : '',
      approvalNeededFrom: gov && Array.isArray(gov.approval_needed_from) ? gov.approval_needed_from.filter(hasVal) : [],
    };
  }

  const AnalysisRendering = {
    factStatement,
    factEvidenceIds,
    confirmedFactEntries,
    unresolvedFactEntries,
    evidenceGapEntries,
    practicalConsequenceEntries,
    positionPathwayDisplay,
    executiveSummaryText,
    whyThisMattersEntries,
    recommendedNextStep,
    governanceInfo,
    POSITION_PATHWAY_DISPLAY,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnalysisRendering;
  }
  global.WatchdogAnalysisRendering = AnalysisRendering;
})(typeof window !== 'undefined' ? window : globalThis);
