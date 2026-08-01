// EntryValidationSupportTests.swift
// Provides Entry Validation Support Tests for Voxt test coverage.

import XCTest
@testable import Voxt

final class EntryValidationSupportTests: XCTestCase {
    func testPrepareAllowsDuplicateNormalizedHotwordTerm() throws {
        let existingEntry = TestFactories.makeEntry(term: "SayIt")

        XCTAssertNoThrow(
            try DictionaryEntryInputPreparer.prepare(
                term: "voxt",
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
                replacementTerms: ["voxt"],
                groupID: nil,
                entries: [existingEntry]
            )
        ) { error in
            guard case DictionaryStoreError.duplicateReplacementTerm("voxt") = error else {
                return XCTFail("Expected duplicateReplacementTerm, got \(error)")
            }
        }
    }
}
