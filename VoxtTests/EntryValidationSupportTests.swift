// EntryValidationSupportTests.swift
// Provides Entry Validation Support Tests for Voxt test coverage.

import XCTest
@testable import Voxt

final class EntryValidationSupportTests: XCTestCase {
    func testPrepareAllowsDuplicateNormalizedHotwordTerm() throws {
        let existingEntry = TestFactories.makeEntry(term: "SayIt")

        XCTAssertNoThrow(
            try DictionaryEntryInputPreparer.prepare(
                term: "sayit",
                replacementTerms: [],
                groupID: nil,
                entries: [existingEntry]
            )
        )
    }

    func testPrepareRejectsReplacementMatchingExistingHotwordTerm() throws {
        let existingEntry = TestFactories.makeEntry(term: "SayIt")

        XCTAssertThrowsError(
            try DictionaryEntryInputPreparer.prepare(
                term: "Voice Input",
                replacementTerms: ["sayit"],
                groupID: nil,
                entries: [existingEntry]
            )
        ) { error in
            guard case DictionaryStoreError.duplicateReplacementTerm("sayit") = error else {
                return XCTFail("Expected duplicateReplacementTerm, got \(error)")
            }
        }
    }
}
