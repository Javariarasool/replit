import { test } from "node:test";
import assert from "node:assert/strict";
import type { RequirementItem, Evidence } from "@workspace/db";
import { completeProposalDrafts, technicalHasBidPricing } from "./proposal-coverage";
import { proposalReadiness } from "./proposal-readiness";
import { logoDimensions } from "./company-logo";

const item = (overrides: Partial<RequirementItem> = {}): RequirementItem => ({
  id: "10000000-0000-4000-8000-000000000001", ownerId: "synthetic", tenderId: "20000000-0000-4000-8000-000000000001",
  extractionId: null, title: "24-port switch", description: "Offer a managed switch", category: "technical",
  sourceKey: "manual:synthetic", sourceReference: "Clause 2", sourceQuote: "Bidder must offer 24-port switch",
  quantity: 2, unit: "pcs", requiresVendor: false, reviewStatus: "approved", revision: 1,
  evidenceIds: ["30000000-0000-4000-8000-000000000001"], webEvidence: [], options: [], selectedOptionId: null,
  researchStatus: "idle", researchError: null, lastResearchedAt: null, createdAt: new Date(), updatedAt: new Date(), ...overrides,
});
const tender = { id: item().tenderId, requirementsExtraction: null } as Parameters<typeof proposalReadiness>[0];
const evidence = { id: item().evidenceIds[0]!, objectPath: "/objects/synthetic", name: "Reviewed human statement",
  notes: "Explicit human-confirmed supporting statement", category: "other" } as Evidence;

test("requires every assessed clause exactly once and puts responses in the proper envelope", () => {
  const tech = item(), commercial = item({ id: "10000000-0000-4000-8000-000000000002", category: "commercial", title: "Payment terms" });
  const result = completeProposalDrafts({ technical: "# Technical proposal", commercial: "# Commercial proposal",
    requirementResponses: [{ requirementId: tech.id, response: "We offer the specified switch; refer to the supporting datasheet." },
      { requirementId: commercial.id, response: "Payment follows clause 4, including the stated commercial conditions." }] }, [tech, commercial]);
  assert.match(result.technical, /T001.*24-port switch/);
  assert.match(result.technical, /Tender reference: Clause 2/);
  assert.doesNotMatch(result.technical, /Payment follows/);
  assert.match(result.commercial, /C001.*Payment terms/);
  assert.doesNotMatch(result.commercial, /We offer the specified switch/);
  assert.throws(() => completeProposalDrafts({ technical: "T", commercial: "C", requirementResponses: [] }, [tech]), /omitted/);
  assert.throws(() => completeProposalDrafts({ technical: "T", commercial: "C", requirementResponses: [
    { requirementId: tech.id, response: "A" }, { requirementId: tech.id, response: "B" }] }, [tech]), /duplicate/);
  assert.throws(() => completeProposalDrafts({ technical: "T", commercial: "C",
    requirementResponses: [{ requirementId: "unknown", response: "A" }] }, [tech]), /unknown/);
  assert.throws(() => completeProposalDrafts({ technical: "T", commercial: "C",
    requirementResponses: [{ requirementId: tech.id, response: "   " }] }, [tech]));
});
test("ready means reviewed current requirements with supporting material; old, missing and pending evidence block drafting", () => {
  assert.equal(proposalReadiness(tender, [item()], [evidence], new Map()).ready, true);
  assert.equal(proposalReadiness(tender, [], [], new Map()).ready, false);
  assert.match(proposalReadiness(tender, [item({ reviewStatus: "pending" })], [evidence], new Map()).blockers[0]!.reasons.join(), /Review and approve/);
  assert.match(proposalReadiness(tender, [item({ evidenceIds: [] })], [], new Map()).blockers[0]!.reasons.join(), /supporting evidence/);
  assert.match(proposalReadiness(tender, [item({ extractionId: "old" })], [evidence], new Map()).blockers[0]!.reasons.join(), /current tender/);
  assert.match(proposalReadiness(tender, [item()], [evidence], new Map([[evidence.objectPath, { status: "needs_review" } as never]])).blockers[0]!.reasons.join(), /OCR review/);
  const company = { ...evidence, companyEvidenceId: "company", applicability: "pending", warnings: ["Needs tender review"] };
  assert.match(proposalReadiness(tender, [item()], [company], new Map()).blockers[0]!.reasons.join(), /company evidence/);
});
test("supplier rows require a human-reviewed sourced quote, quantity and Pakistan delivery", () => {
  const option = { id: "40000000-0000-4000-8000-000000000001", reviewed: true, datasheetUrl: "https://example.com/datasheet",
    deliveryStatus: "source_states_pakistan", pricePkr: 1000, priceSourceUrl: "https://example.com/quote", quoteEvidenceId: null,
    gaps: [] } as unknown as RequirementItem["options"][number];
  const row = item({ requiresVendor: true, options: [option], selectedOptionId: option.id });
  assert.equal(proposalReadiness(tender, [row], [evidence], new Map()).ready, true);
  const absentPrice = proposalReadiness(tender, [{ ...row, options: [{ ...option, pricePkr: null }] }], [evidence], new Map());
  assert.match(absentPrice.blockers[0]!.reasons.join(), /PKR unit price/);
  assert.match(proposalReadiness(tender, [{ ...row, options: [{ ...option, reviewed: false }] }], [evidence], new Map()).blockers[0]!.reasons.join(), /human-confirm/);
  assert.match(proposalReadiness(tender, [{ ...row, quantity: null }], [evidence], new Map()).blockers[0]!.reasons.join(), /quantity/);
  assert.match(proposalReadiness(tender, [{ ...row, options: [{ ...option, gaps: ["Required ports not confirmed"] }] }], [evidence], new Map()).blockers[0]!.reasons.join(), /specification gaps/);
});
test("logos have actual PNG/JPEG signatures and bounded dimensions; SVG, huge and corrupt files are rejected", () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
  assert.deepEqual(logoDimensions(bytes), { contentType: "image/png", width: 1, height: 1 });
  const large = Buffer.from(bytes); large.writeUInt32BE(4001, 16);
  assert.throws(() => logoDimensions(large), /dimensions/);
  assert.throws(() => logoDimensions(Buffer.from("<svg></svg>")), /PNG or JPEG/);
  assert.throws(() => logoDimensions(Buffer.alloc(2 * 1024 * 1024 + 1)), /2 MB/);
  assert.throws(() => logoDimensions(Buffer.from([0xff, 0xd8, 0, 0, 0, 0])), /dimensions/);
});
test("technical separation blocks actual bid prices, not required financial eligibility evidence", () => {
  assert.equal(technicalHasBidPricing("Annual turnover: PKR 30,000,000, supported by current financial statements."), false);
  assert.equal(technicalHasBidPricing("Past project value: PKR 5,000,000 as shown by completion certificate."), false);
  assert.equal(technicalHasBidPricing("Offered unit price: PKR 125,000"), true);
  assert.equal(technicalHasBidPricing("| Unit price PKR |"), true);
  assert.equal(technicalHasBidPricing("Cisco switch: PKR 125,000"), true);
  assert.equal(technicalHasBidPricing("Annual turnover PKR 30,000,000. Bid price PKR 1,000,000."), true);
});
