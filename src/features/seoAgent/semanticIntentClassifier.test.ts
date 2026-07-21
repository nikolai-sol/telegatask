import { describe, expect, it } from "vitest";
import expectedClassifications from "./fixtures/semanticIntentClassifier/expectedClassifications.json";
import inputQueries from "./fixtures/semanticIntentClassifier/inputQueries.json";
import { zarukuSeoProductionConfig } from "./production/zaruku/zarukuSeoProductionConfig";
import { classifySemanticIntent, SEMANTIC_INTENT_CLASS_PRIORITY } from "./semanticIntentClassifier";

describe("classifySemanticIntent", () => {
  it("classifies Zaruku queries deterministically from config tokens", () => {
    const classifications = inputQueries.map((query) => {
      const result = classifySemanticIntent(query, zarukuSeoProductionConfig.semanticIntent);
      return {
        query: result.query,
        intentClass: result.intentClass,
        rule: result.rule,
        isTarget: result.isTarget,
      };
    });

    expect(classifications).toEqual(expectedClassifications);
  });

  it("keeps the Chapter 6 conflict priority explicit", () => {
    expect(SEMANTIC_INTENT_CLASS_PRIORITY).toEqual([
      "drug_compliance",
      "competitor_brand",
      "own_brand",
      "facility_navigational",
      "medical_informational",
      "supportive_trust",
      "off_mission",
    ]);
  });
});
