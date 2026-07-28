'use strict';

/* ══════════════════════════════════════════════════════════════════
   WATCHDOG V8 — PUBLIC REVIEW MIRROR
   Fixture data only. Every id, name, and note below is fabricated for
   this review mirror. No production database row, real member name, or
   real private note appears anywhere in this file. Loaded before
   auth.js / repository.js / realtime.js so those fixture modules can
   read window.WATCHDOG_FIXTURES directly.

   The "baseline specimen" analysis (id starting aaaa1111) intentionally
   reproduces the seven documented V7.1 rendering defects — see
   docs/watchdog-v8-review-mirror.md. It is NOT a bug in this file; the
   defects are in how dashboard.js renders this shape of data, and this
   mirror exists specifically so that rendering can be reviewed.
   ══════════════════════════════════════════════════════════════════ */

(function (global) {
  const now = new Date('2026-07-28T14:00:00Z');
  const iso = (daysAgo, hour = 12) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  const PROFILE = {
    id: 'f1x7000-0000-0000-0000-000000000001',
    username: 'reviewer',
    display_name: 'Review Mirror User',
    role: 'Administrator',
    is_active: true,
    created_at: iso(400),
    updated_at: iso(1),
  };

  const OTHER_PROFILE = {
    id: 'f1x7000-0000-0000-0000-000000000002',
    username: 'collaborator_sample',
    display_name: 'Sample Collaborator',
    role: 'Collaborator',
    is_active: true,
    created_at: iso(300),
    updated_at: iso(30),
  };

  /* ── Signals — every requested representative state ────────────── */
  const SIGNALS = [
    {
      id: 9001, title: 'Allen City Council to consider zoning change for mixed-use development at Watters Creek',
      snippet: 'Staff recommends approval of a planned development amendment allowing ground-floor retail with residential above.',
      summary: null, source: 'Allen City Council Agenda', category: 'Zoning', subcategory: 'Planned Development',
      jurisdiction: 'Allen', county: 'Collin', stage: 'Agenda Posted', review_status: null,
      confidence_level: 'High', confidence_reason: 'Official agenda packet, primary source.',
      why_matters: null, meeting_body: 'Allen City Council', staff_contact: null, related_issues: null,
      dismissed_reason: null, matched_keywords: ['zoning', 'mixed-use', 'planned development'],
      url: 'https://example.com/allen/agendas/2026-08-04', published_at: iso(2), agenda_date: iso(-3),
      priority: 'High', priority_level: null, detected_at: iso(2, 9), validation_disposition: 'Accepted',
      matched_source_id: 'src-1', is_verified_public_source: true, is_member_signal: false,
    },
    {
      id: 9002, title: 'Plano ISD Board Meeting Agenda Item 7.3: Approval of FY2027 Preliminary Budget Framework and Associated Tax Rate Discussion Pursuant to Chapter 44',
      snippet: 'Board to review preliminary budget assumptions ahead of the fall adoption calendar.',
      summary: null, source: 'Plano ISD', category: 'Budget', subcategory: 'ISD Finance',
      jurisdiction: 'Plano', county: 'Collin', stage: 'Agenda Posted', review_status: 'Reviewed',
      confidence_level: 'High', confidence_reason: 'Official board agenda.', why_matters: null,
      meeting_body: 'Plano ISD Board of Trustees', staff_contact: null, related_issues: null,
      dismissed_reason: null, matched_keywords: ['budget', 'tax rate'],
      url: 'https://example.com/planoisd/agendas/2026-08-11', published_at: iso(5), agenda_date: iso(-1),
      priority: 'Medium', priority_level: null, detected_at: iso(5, 14), validation_disposition: 'Accepted',
      matched_source_id: 'src-2', is_verified_public_source: true, is_member_signal: false,
    },
    {
      id: 9003, title: 'Greenville looks at new sign rules for local businesses', snippet: 'City staff drafted updated sign ordinance language for downtown storefronts.',
      summary: null, source: 'Herald-Banner', category: 'Land Use', subcategory: 'Sign Ordinance',
      jurisdiction: 'Greenville', county: 'Hunt', stage: 'News Coverage', review_status: null,
      confidence_level: 'Medium', confidence_reason: 'Local news coverage, not yet on an official agenda.',
      why_matters: null, meeting_body: null, staff_contact: null, related_issues: null, dismissed_reason: null,
      matched_keywords: ['sign ordinance'], url: 'https://example.com/heraldbanner/news/sign-rules',
      published_at: iso(9), agenda_date: null, priority: 'Monitor', priority_level: null, detected_at: iso(9, 8),
      validation_disposition: 'Accepted', matched_source_id: 'src-3', is_verified_public_source: false, is_member_signal: false,
    },
    {
      id: 9004, title: 'Rockwall County Commissioners Court item on road bond project list', snippet: 'Court to discuss prioritization of FM 552 improvements within the 2025 bond program.',
      summary: null, source: 'Rockwall County', category: 'Infrastructure', subcategory: 'Road Bond',
      jurisdiction: 'Rockwall County', county: 'Rockwall', stage: 'Agenda Posted', review_status: 'Reviewed',
      confidence_level: 'High', confidence_reason: 'Official county agenda.', why_matters: null,
      meeting_body: 'Rockwall County Commissioners Court', staff_contact: null, related_issues: null, dismissed_reason: null,
      matched_keywords: ['road bond', 'infrastructure'], url: 'https://example.com/rockwallcounty/agendas/2026-08-05',
      published_at: iso(3), agenda_date: iso(-4), priority: 'High', priority_level: null, detected_at: iso(3, 10),
      validation_disposition: 'Accepted', matched_source_id: 'src-4', is_verified_public_source: true, is_member_signal: false,
    },
    {
      id: 9005, title: 'Allen City Council to consider zoning change for mixed-use development at Watters Creek (Community Impact coverage)',
      snippet: 'Local news recap of the same Allen zoning item, covering the staff recommendation.',
      summary: null, source: 'Community Impact', category: 'Zoning', subcategory: 'Planned Development',
      jurisdiction: 'Allen', county: 'Collin', stage: 'News Coverage', review_status: null,
      confidence_level: 'Medium', confidence_reason: 'Secondary news coverage of the same agenda item.',
      why_matters: null, meeting_body: null, staff_contact: null, related_issues: null, dismissed_reason: null,
      matched_keywords: ['zoning', 'mixed-use'], url: 'https://example.com/communityimpact/allen-zoning',
      published_at: iso(2, 15), agenda_date: null, priority: 'High', priority_level: null, detected_at: iso(2, 16),
      validation_disposition: 'Accepted', matched_source_id: 'src-5', is_verified_public_source: false, is_member_signal: false,
    },
    {
      id: 9006, title: 'Van Zandt County discusses short-term rental registration', snippet: 'Commissioners requested a draft ordinance for review at a future meeting.',
      summary: null, source: 'Van Zandt County', category: 'Land Use', subcategory: 'Short-Term Rental',
      jurisdiction: 'Van Zandt County', county: 'Van Zandt', stage: 'Discussion Only', review_status: null,
      confidence_level: 'Low', confidence_reason: 'Preliminary discussion, no draft language yet.',
      why_matters: null, meeting_body: 'Van Zandt County Commissioners Court', staff_contact: null,
      related_issues: null, dismissed_reason: null, matched_keywords: ['short-term rental'],
      url: 'https://example.com/vanzandtcounty/agendas/2026-07-22', published_at: iso(14), agenda_date: iso(-10),
      priority: 'Monitor', priority_level: null, detected_at: iso(14, 11), validation_disposition: 'Accepted',
      matched_source_id: 'src-6', is_verified_public_source: true, is_member_signal: false,
    },
    {
      id: 9007, title: 'Item flagged for manual geography review — county field ambiguous', snippet: 'Automated collector could not confidently assign a focus county for this item.',
      summary: null, source: 'Regional News Aggregator', category: 'Uncategorized', subcategory: null,
      jurisdiction: 'Unknown', county: 'Collin', stage: 'Needs Review', review_status: null,
      confidence_level: 'Low', confidence_reason: 'Geography could not be confirmed automatically.',
      why_matters: null, meeting_body: null, staff_contact: null, related_issues: null, dismissed_reason: null,
      matched_keywords: [], url: 'https://example.com/aggregator/item-7', published_at: iso(6), agenda_date: null,
      priority: 'Monitor', priority_level: null, detected_at: iso(6, 7), validation_disposition: 'Quarantined',
      matched_source_id: 'src-7', is_verified_public_source: false, is_member_signal: false,
    },
    {
      id: 9008, title: 'Duplicate collection artifact — same council meeting, two feeds', snippet: 'Collected twice from overlapping RSS feeds; superseded by another accepted record.',
      summary: null, source: 'Secondary Feed', category: 'Zoning', subcategory: null,
      jurisdiction: 'Allen', county: 'Collin', stage: 'Agenda Posted', review_status: null,
      confidence_level: 'Medium', confidence_reason: null, why_matters: null, meeting_body: null,
      staff_contact: null, related_issues: null, dismissed_reason: 'Duplicate of an already-accepted signal.',
      matched_keywords: [], url: 'https://example.com/allen/agendas/2026-08-04', published_at: iso(2, 1),
      agenda_date: iso(-3), priority: 'High', priority_level: null, detected_at: iso(2, 2),
      validation_disposition: 'Suppressed', matched_source_id: 'src-1', is_verified_public_source: true, is_member_signal: false,
    },
  ];

  /* ── Policy Matters (Active Matters view) ─────────────────────── */
  const POLICY_MATTERS = [
    {
      id: 'mat-0000-0000-0000-000000000001', title: 'Allen Watters Creek Mixed-Use Zoning', status: 'Monitoring',
      created_by: PROFILE.id, assigned_owner_id: PROFILE.id, next_action: 'Await staff report before council vote.',
      follow_up_date: iso(-5), resolved_at: null, created_at: iso(2), updated_at: iso(1),
    },
    {
      id: 'mat-0000-0000-0000-000000000002', title: 'Rockwall County Road Bond Prioritization', status: 'Action Required',
      created_by: PROFILE.id, assigned_owner_id: OTHER_PROFILE.id, next_action: 'Draft comment letter on FM 552 priority.',
      follow_up_date: iso(3), resolved_at: null, created_at: iso(6), updated_at: iso(1),
    },
    {
      id: 'mat-0000-0000-0000-000000000003', title: 'Van Zandt STR Registration (overdue follow-up)', status: 'Action Required',
      created_by: PROFILE.id, assigned_owner_id: PROFILE.id, next_action: 'Follow up with county staff on draft timeline.',
      follow_up_date: iso(-9), resolved_at: null, created_at: iso(20), updated_at: iso(10),
    },
    {
      id: 'mat-0000-0000-0000-000000000004', title: 'Greenville Sign Ordinance (resolved)', status: 'Closed',
      created_by: PROFILE.id, assigned_owner_id: PROFILE.id, next_action: '', follow_up_date: null,
      resolved_at: iso(4), created_at: iso(60), updated_at: iso(4),
    },
  ];

  /* ── Source registry / endpoints / scanner runs ───────────────── */
  const SOURCE_REGISTRY = [
    { id: 'src-1', source_key: 'allen_city_council', source_name: 'Allen City Council', source_type: 'Official Government', source_lane: 'Agenda', source_priority: 'High', county: 'Collin', jurisdiction: 'Allen', counties: ['Collin'], jurisdictions: ['Allen'], reliability: 'VH', monitoring_method: 'Agenda Scan', coverage_status: 'Active', status: 'active', is_active: true, canonical_domain: 'example.com/allen', known_limitations: null },
    { id: 'src-2', source_key: 'plano_isd', source_name: 'Plano ISD', source_type: 'Official Government', source_lane: 'Agenda', source_priority: 'Medium', county: 'Collin', jurisdiction: 'Plano', counties: ['Collin'], jurisdictions: ['Plano'], reliability: 'VH', monitoring_method: 'Agenda Scan', coverage_status: 'Active', status: 'active', is_active: true, canonical_domain: 'example.com/planoisd', known_limitations: null },
    { id: 'src-3', source_key: 'herald_banner', source_name: 'Herald-Banner', source_type: 'News Media', source_lane: 'News', source_priority: 'Medium', county: 'Hunt', jurisdiction: 'Greenville', counties: ['Hunt'], jurisdictions: ['Greenville'], reliability: 'MH', monitoring_method: 'RSS', coverage_status: 'Active', status: 'active', is_active: true, canonical_domain: 'example.com/heraldbanner', known_limitations: 'Paywalled beyond the first paragraph.' },
    { id: 'src-4', source_key: 'rockwall_county', source_name: 'Rockwall County', source_type: 'Official Government', source_lane: 'Agenda', source_priority: 'High', county: 'Rockwall', jurisdiction: 'Rockwall County', counties: ['Rockwall'], jurisdictions: ['Rockwall County'], reliability: 'VH', monitoring_method: 'Agenda Scan', coverage_status: 'Active', status: 'active', is_active: true, canonical_domain: 'example.com/rockwallcounty', known_limitations: null },
    { id: 'src-5', source_key: 'community_impact', source_name: 'Community Impact', source_type: 'News Media', source_lane: 'News', source_priority: 'Low', county: 'Collin', jurisdiction: null, counties: ['Collin', 'Denton'], jurisdictions: [], reliability: 'H', monitoring_method: 'RSS', coverage_status: 'Active', status: 'active', is_active: true, canonical_domain: 'example.com/communityimpact', known_limitations: null },
    { id: 'src-6', source_key: 'van_zandt_county', source_name: 'Van Zandt County', source_type: 'Official Government', source_lane: 'Agenda', source_priority: 'Medium', county: 'Van Zandt', jurisdiction: 'Van Zandt County', counties: ['Van Zandt'], jurisdictions: ['Van Zandt County'], reliability: 'VH', monitoring_method: 'Agenda Scan', coverage_status: 'Active', status: 'active', is_active: true, canonical_domain: 'example.com/vanzandtcounty', known_limitations: null },
    { id: 'src-7', source_key: 'regional_aggregator', source_name: 'Regional News Aggregator', source_type: 'News Media', source_lane: 'News', source_priority: 'Low', county: null, jurisdiction: null, counties: [], jurisdictions: [], reliability: 'MH', monitoring_method: 'RSS', coverage_status: 'Active', status: 'active', is_active: true, canonical_domain: 'example.com/aggregator', known_limitations: 'Geography must be inferred; not always reliable.' },
    { id: 'src-8', source_key: 'mckinney_city_council', source_name: 'McKinney City Council', source_type: 'Official Government', source_lane: 'Agenda', source_priority: 'Medium', county: 'Collin', jurisdiction: 'McKinney', counties: ['Collin'], jurisdictions: ['McKinney'], reliability: 'VH', monitoring_method: 'Agenda Scan', coverage_status: 'Inactive', status: 'inactive', is_active: false, canonical_domain: 'example.com/mckinney', known_limitations: 'Endpoint returning 404 as of the most recent scan — see scanner run history.' },
  ];

  const SOURCE_ENDPOINTS = SOURCE_REGISTRY.map((s, i) => ({
    id: 'ep-' + (i + 1), source_id: s.id, endpoint_name: s.source_name + ' Agendas', endpoint_url: 'https://example.com/agendas',
    endpoint_type: 'Agenda', is_active: s.is_active,
  }));

  const SCANNER_RUNS = [
    { id: 'run-0000-0000-0000-000000000001', started_at: iso(0, 6), completed_at: iso(0, 6), status: 'Successful', signals_collected: 12, source_count: 34 },
    { id: 'run-0000-0000-0000-000000000002', started_at: iso(1, 6), completed_at: iso(1, 6), status: 'Successful', signals_collected: 9, source_count: 34 },
    { id: 'run-0000-0000-0000-000000000003', started_at: iso(2, 6), completed_at: iso(2, 6), status: 'Warning', signals_collected: 4, source_count: 34, warning_summary: 'Two source endpoints returned no items — possible upstream site change.' },
  ];

  const SCANNER_RUN_STEPS = [
    { id: 'step-1', scanner_run_id: 'run-0000-0000-0000-000000000003', source_id: 'src-8', status: 'Failed', message: 'HTTP 404 — endpoint URL may have moved.', started_at: iso(2, 6) },
    { id: 'step-2', scanner_run_id: 'run-0000-0000-0000-000000000003', source_id: 'src-7', status: 'Warning', message: 'Zero items returned; feed responded but was empty.', started_at: iso(2, 6) },
    { id: 'step-3', scanner_run_id: 'run-0000-0000-0000-000000000001', source_id: 'src-1', status: 'Successful', message: null, started_at: iso(0, 6) },
  ];

  const AUDIT_EVENTS = [
    { id: 'aud-1', scope: 'Shared', entity_type: 'Policy Matter', entity_id: POLICY_MATTERS[0].id, action: 'created', actor_user_id: PROFILE.id, created_at: iso(2) },
    { id: 'aud-2', scope: 'Shared', entity_type: 'Signal Intelligence Analysis', entity_id: 'aaaa1111-0000-0000-0000-000000000001', action: 'draft_edited', actor_user_id: PROFILE.id, created_at: iso(0, 15), changed_fields: { changed_fields: ['executive_summary'], note: null } },
  ];

  /* ── The V7.1 baseline specimen (sanitized reconstruction) ──────
     Reproduces the seven documented rendering defects exactly, using
     the SAME field shapes signal_intelligence_analyses actually has.
     See docs/watchdog-v8-review-mirror.md for the defect-by-defect
     mapping to the fields below.                                    */
  const BASELINE_SPECIMEN_SIGNAL_ID = 9004; // Rockwall road-bond signal, reused as the specimen's subject

  const BASELINE_ANALYSIS = {
    id: 'aaaa1111-0000-0000-0000-000000000001',
    signal_id: BASELINE_SPECIMEN_SIGNAL_ID,
    analysis_version: 1,
    status: 'Draft',
    created_by: PROFILE.id, reviewed_by: null, approved_by: null,
    created_at: iso(0, 15), reviewed_at: null, approved_at: null,
    provider: 'manual_chatgpt', model: 'user-supervised ChatGPT', doctrine_version: 'doctrine-v7-2026-07-28',
    evidence_packet_id: 'evid-0000-0000-0000-000000000001', generation_run_id: 'run-intel-0000-0000-0000-000000000001',
    source_snapshot_hash: 'fixture-hash', is_stale: false, stale_reason: null,
    // Defect 5: Executive Summary is visually truncated — a long, real
    // paragraph is supplied so the CSS clamp/overflow behavior is visible.
    executive_summary: 'The evidence confirms only that the Collin County Commissioners Court agenda includes a road bond prioritization item for FM 552 improvements; the practical scope, funding mechanism, and timeline are not established in the material collected so far, and no organizational position has been identified as applicable to this specific prioritization decision at this stage of the process.',
    // Defect 1: Confirmed Facts renders as empty bullets — the imported
    // response's confirmed_facts entries are {statement, evidence_ids}
    // objects, and the Analysis-tab renderer reads a `.text`/`.question`
    // field that these objects don't have, producing empty <li> bullets.
    confirmed_facts: [
      { statement: 'A road bond prioritization item for FM 552 is on the agenda.', evidence_ids: ['E1'] },
      { statement: 'The item originates from the county’s 2025 bond program.', evidence_ids: ['E1'] },
    ],
    unresolved_facts: ['Exact funding allocation across listed projects is not specified in the evidence.'],
    // Defect 2: Why It Matters shows "Not addressed" — the imported
    // response has no dedicated why_it_matters field (see
    // docs/watchdog-chatgpt-packet-format.md's field-mapping table); the
    // column is left null and the Analysis tab's fallback text renders.
    why_it_matters: null,
    practical_consequences: 'Prioritization could affect which segment of FM 552 sees construction first, with resulting effects on nearby property access during construction.',
    organizational_relevance: 'Touches transportation-infrastructure interests relevant to member commute patterns and development access.',
    geographic_significance: 'Localized to a specific county road segment rather than a region-wide policy change.',
    materiality_level: 'Medium',
    materiality_rationale: 'Affects one road segment’s construction sequencing, not county-wide policy.',
    evidence_quality: 'Medium',
    // Defect 4: evidence gaps flatten into a dense paragraph — the
    // imported response's evidence_quality.gaps + .contradictions arrays
    // are joined with "; " into one long evidence_gaps string, with no
    // line breaks or bullet structure preserved in the Analysis tab.
    evidence_gaps: 'No draft engineering scope attached to the agenda item; funding split across listed bond projects not itemized; timeline for construction start not stated; whether public comment period applies to this specific prioritization step is unclear; prior court discussion referenced but not linked.',
    // Defect 3: insufficient_evidence renders identically to
    // "No organizational position established" — both source tokens map
    // to the same doctrine pathway string (see
    // docs/watchdog-chatgpt-packet-format.md's position-pathway table),
    // so the Analysis tab cannot visually distinguish "we checked and no
    // position applies" from "there isn't enough evidence to tell yet."
    position_pathway: 'No organizational position established',
    potential_applicable_position_id: null,
    potential_applicable_position_note: 'No adopted position was found covering road-bond prioritization sequencing specifically.',
    position_confidence: 'Unclear',
    intelligence_priority: 'Medium', human_approved_priority: null,
    priority_rationale: 'Meaningful for the affected corridor; not indicated as unusually urgent in the available evidence.',
    urgency: 'Routine', opportunity_for_influence: 'Public comment period likely available before final prioritization.',
    proposed_response_options: ['Continue monitoring', 'Request field context'],
    recommended_governance_path: 'No position is being proposed at this stage; monitor for the draft prioritization list.',
    relationship_considerations: '', regional_spillover: 'Low', precedent_risk: 'Low',
    citations: [
      { source_id: 'E1', url: 'https://example.com/rockwallcounty/agendas/2026-08-05', quote_or_reference: 'Agenda item: "Discussion of FM 552 improvements within the 2025 road bond program."' },
    ],
    usage_metadata: {
      generation_method: 'manual_import', schema_version: 'manual-pilot-v1',
      imported_by: PROFILE.id, imported_at: iso(0, 15),
      inferences: [{ statement: 'Enforcement/construction sequencing will likely be discussed at a future meeting.', basis: 'Typical for multi-project bond prioritization items.', confidence: 'medium', evidence_ids: ['E1'] }],
      warnings: ['Evidence does not specify a fee, cost, or exact mile-marker range.'],
      analyst_note: 'AI-generated draft — human review required.',
      organizational_relevance_rationale: 'Transportation access is a recurring member-relevant theme.',
      geographic_significance_rationale: 'Single-corridor item, not a policy change.',
      // V8: the full original (sanitized) ChatGPT response, preserved
      // verbatim alongside the flattened columns above — this is what
      // lets the V8 Analysis tab distinguish insufficient_evidence from
      // no_position_established, render evidence gaps/contradictions and
      // practical consequences as real lists, and surface a recommended
      // next step, exactly as a genuine manual-pilot import would.
      raw_imported_response: {
        marker: 'FIXTURE-SANITIZED-BASELINE-SPECIMEN',
        evidence_quality: {
          level: 'medium',
          gaps: ['No draft engineering scope attached to the agenda item.', 'Funding split across listed bond projects not itemized.', 'Timeline for construction start not stated.'],
          contradictions: ['Prior court discussion referenced in the packet but not linked to a specific agenda item.'],
        },
        practical_consequences: [
          'Prioritization could affect which segment of FM 552 sees construction first.',
          'Nearby property access may be affected during construction on whichever segment is prioritized.',
        ],
        position: {
          pathway: 'insufficient_evidence',
          potential_position: 'No adopted position was found covering road-bond prioritization sequencing specifically.',
          confidence: 'low',
        },
        response: {
          proposed_options: ['Continue monitoring', 'Request field context'],
          preferred_option: 'Continue monitoring until the draft prioritization list is published.',
        },
        governance: { required: false, recommended_route: 'No position is being proposed at this stage; monitor for the draft prioritization list.', approval_needed_from: [] },
      },
      edit_history: [
        { editor: PROFILE.id, edited_at: iso(0, 15), changed_fields: ['executive_summary'], material_change: false, note: null },
      ],
    },
    review_note: null, updated_at: iso(0, 15),
  };

  /* ── A second analysis: awaiting review, on a different signal ── */
  const SECOND_ANALYSIS = {
    ...BASELINE_ANALYSIS,
    id: 'aaaa1111-0000-0000-0000-000000000002',
    signal_id: 9001,
    analysis_version: 1,
    status: 'Human Reviewed',
    reviewed_by: OTHER_PROFILE.id,
    reviewed_at: iso(1),
    executive_summary: 'The evidence confirms a planned-development amendment for mixed-use retail and residential at Watters Creek is recommended for approval by staff.',
    intelligence_priority: 'High',
    review_note: 'Reviewed for accuracy against the agenda packet; content reads consistent with the source.',
  };

  const ANALYSES_BY_SIGNAL = {
    9004: [BASELINE_ANALYSIS],
    9001: [SECOND_ANALYSIS],
  };

  const EVIDENCE_PACKET_TEXT = [
    '===== WATCHDOG EWS — INTELLIGENCE PACKET (MANUAL CHATGPT PILOT) — REVIEW MIRROR =====',
    'This is a FIXTURE packet for design-review purposes only. No real evidence was assembled.',
    '',
    'PACKET METADATA',
    '  packet_id: evid-0000-0000-0000-000000000001',
    '  signal_id: 9004',
    '  doctrine_version: doctrine-v7-2026-07-28',
    '  schema_version: manual-pilot-v1',
    '  jurisdiction: Rockwall County',
    '  scanner_priority: High',
    '',
    'PACKET EVIDENCE (1 source):',
    '[E1] Signal (primary): Rockwall County Commissioners Court item on road bond project list',
    '  url: https://example.com/rockwallcounty/agendas/2026-08-05',
    '  excerpt: Court to discuss prioritization of FM 552 improvements within the 2025 bond program.',
    '',
    '(Full doctrine instructions and required response JSON shape omitted from this fixture for',
    ' brevity — see docs/watchdog-chatgpt-packet-format.md for the real, complete packet format.)',
  ].join('\n');

  // Deliberately empty — these registry-grade tables exist in production
  // but have no rows populated yet even there; kept empty here so the
  // Sources screen's empty-state rendering (a required representative
  // state per the review-mirror ticket) is visible for these sub-panels.
  const SOURCE_REPORTER_WATCHES = [];
  const SOURCE_GEOGRAPHY_RULES = [];
  const SPECIAL_DISTRICT_REGISTRY = [];

  global.WATCHDOG_FIXTURES = {
    PROFILE, OTHER_PROFILE, SIGNALS, POLICY_MATTERS, SOURCE_REGISTRY, SOURCE_ENDPOINTS,
    SOURCE_REPORTER_WATCHES, SOURCE_GEOGRAPHY_RULES, SPECIAL_DISTRICT_REGISTRY,
    SCANNER_RUNS, SCANNER_RUN_STEPS, AUDIT_EVENTS, BASELINE_ANALYSIS, SECOND_ANALYSIS,
    ANALYSES_BY_SIGNAL, BASELINE_SPECIMEN_SIGNAL_ID, EVIDENCE_PACKET_TEXT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
