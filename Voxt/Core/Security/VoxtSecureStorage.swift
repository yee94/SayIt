// VoxtSecureStorage.swift
// Provides Voxt Secure Storage for permissions and secure storage.

import Foundation
import LocalAuthentication
import Security

enum VoxtSecureStorage {
    enum StorageError: Error, Equatable {
        case invalidUTF8
        case unexpectedStatus(OSStatus)
    }

    enum MigrationLookupResult: Equatable {
        case value(String)
        case missing
        case unavailable
    }

    nonisolated private static let defaultServiceName: String = {
        let bundleID = Bundle.main.bundleIdentifier ?? "com.sayit.app"
        return "\(bundleID).secure-storage"
    }()

    nonisolated private static let stateLock = NSLock()
    nonisolated(unsafe) private static var cachedValues: [String: String] = [:]

    // Unit tests run with code signing disabled in CI. Keep their credentials out
    // of the user's real keychain while exercising the same migration behavior.
    nonisolated(unsafe) private static var usesInMemoryStoreForTesting = isRunningUnderXCTest
    nonisolated(unsafe) private static var protectedValuesForTesting: [String: String] = [:]
    nonisolated(unsafe) private static var legacyValuesForTesting: [String: String] = [:]
    nonisolated(unsafe) private static var protectedWritesFailForTesting = false
    nonisolated(unsafe) private static var deletesFailForTesting = false

    nonisolated private static let isRunningUnderXCTest: Bool = {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
            NSClassFromString("XCTestCase") != nil ||
            NSClassFromString("XCTest.XCTestCase") != nil
    }()

    nonisolated private static var serviceName: String {
        defaultServiceName
    }

    nonisolated static func string(for account: String) -> String? {
        if let cached = cachedValue(for: account) {
            return cached
        }

        if isUsingInMemoryStoreForTesting {
            if let value = protectedValueForTesting(for: account) {
                cache(value, for: account)
                _ = deleteLegacyValueForTesting(for: account)
                return value
            }
            return migrateLegacyValueForTesting(for: account)
        }

        if let value = readString(from: .authoritative, account: account) {
            cache(value, for: account)
            // Authoritative item wins. Cleanup of alternate-store copies is best
            // effort and must never make the current value unavailable.
            _ = deleteValue(in: .alternate, for: account, interactionAllowed: false)
            return value
        }
        return migrateLegacyValue(for: account)
    }

    /// Reads only from the authoritative Keychain item.
    /// Unlike `string(for:)`, this API never consults the process cache and
    /// never performs legacy migration as a side effect.
    nonisolated static func protectedString(for account: String) throws -> String? {
        if isUsingInMemoryStoreForTesting {
            return protectedValueForTesting(for: account)
        }

        return try readStringStrict(from: .authoritative, account: account)
    }

    /// Upserts an authoritative Keychain item. The update changes only the
    /// secret data; accessibility is fixed when adding.
    nonisolated static func setProtectedString(_ value: String, for account: String) throws {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            try removeProtectedString(for: account)
            return
        }

        if isUsingInMemoryStoreForTesting {
            guard setProtectedValueForTesting(value, for: account) else {
                throw StorageError.unexpectedStatus(errSecNotAvailable)
            }
            return
        }

        try writeString(value, to: .authoritative, account: account)
        cache(value, for: account)
    }

    nonisolated static func removeProtectedString(for account: String) throws {
        if isUsingInMemoryStoreForTesting {
            stateLock.lock()
            defer { stateLock.unlock() }
            guard !deletesFailForTesting else {
                throw StorageError.unexpectedStatus(errSecNotAvailable)
            }
            protectedValuesForTesting.removeValue(forKey: account)
            cachedValues.removeValue(forKey: account)
            return
        }

        guard deleteValue(in: .authoritative, for: account, interactionAllowed: true) else {
            throw StorageError.unexpectedStatus(errSecNotAvailable)
        }
        removeCachedValue(for: account)
    }

    nonisolated static func hasString(for account: String) -> Bool {
        if cachedValue(for: account) != nil {
            return true
        }

        if isUsingInMemoryStoreForTesting {
            return protectedValueForTesting(for: account) != nil || legacyValueForTesting(for: account) != nil
        }

        if hasValue(in: .authoritative, account: account) {
            return true
        }
        return hasValue(in: .alternate, account: account)
    }

    /// Performs the one-time legacy lookup used by configuration migration.
    /// `missing` is returned only when both stores are definitively empty;
    /// transient Keychain failures remain `unavailable` so callers never erase
    /// configuration metadata based on an inconclusive read.
    nonisolated static func migrationValue(for account: String) -> MigrationLookupResult {
        if isUsingInMemoryStoreForTesting {
            if let value = protectedValueForTesting(for: account) {
                cache(value, for: account)
                _ = deleteLegacyValueForTesting(for: account)
                return .value(value)
            }
            guard let legacyValue = legacyValueForTesting(for: account) else {
                return .missing
            }
            guard !legacyValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return .missing
            }
            guard setProtectedValueForTesting(legacyValue, for: account),
                  protectedValueForTesting(for: account) == legacyValue
            else {
                return .unavailable
            }
            _ = deleteLegacyValueForTesting(for: account)
            return .value(legacyValue)
        }

        do {
            if let value = try readStringStrict(from: .authoritative, account: account) {
                cache(value, for: account)
                _ = deleteValue(in: .alternate, for: account, interactionAllowed: false)
                return .value(value)
            }
        } catch {
            VoxtLog.securityWarning(
                "Authoritative Keychain migration lookup failed. account=\(account), error=\(error.localizedDescription)"
            )
            return .unavailable
        }

        do {
            guard let value = try readStringStrict(from: .alternate, account: account) else {
                return .missing
            }
            guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return .missing
            }
            guard set(value, for: account), authoritativeData(for: account) == Data(value.utf8) else {
                VoxtLog.securityWarning("Legacy Keychain migration could not be committed. account=\(account)")
                return .unavailable
            }
            if !deleteValue(in: .alternate, for: account, interactionAllowed: false) {
                VoxtLog.securityWarning("Legacy Keychain migration cleanup failed. account=\(account)")
            }
            return .value(value)
        } catch let StorageError.unexpectedStatus(status)
            where status == errSecInteractionNotAllowed || status == errSecAuthFailed {
            VoxtLog.securityWarning(
                "Legacy Keychain migration is temporarily unavailable. account=\(account), status=\(status)"
            )
            return .unavailable
        } catch {
            VoxtLog.securityWarning(
                "Legacy Keychain migration lookup failed. account=\(account), error=\(error.localizedDescription)"
            )
            return .unavailable
        }
    }

    @discardableResult
    nonisolated static func set(_ value: String, for account: String) -> Bool {
        guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return removeValue(for: account)
        }

        if isUsingInMemoryStoreForTesting {
            return setProtectedValueForTesting(value, for: account)
        }

        do {
            try writeString(value, to: .authoritative, account: account)
            cache(value, for: account)
            return true
        } catch {
            VoxtLog.securityWarning(
                "Keychain write failed. account=\(account), error=\(error.localizedDescription)"
            )
            return false
        }
    }

    @discardableResult
    nonisolated static func removeValue(for account: String) -> Bool {
        removeCachedValue(for: account)

        if isUsingInMemoryStoreForTesting {
            return removeValuesForTesting(for: account)
        }

        // Delete the alternate-store copy first. If its ACL prevents
        // noninteractive deletion, keep the authoritative copy intact so
        // callers can retry without reviving an older credential.
        guard deleteValue(in: .alternate, for: account, interactionAllowed: false) else {
            return false
        }
        return deleteValue(in: .authoritative, for: account, interactionAllowed: true)
    }

    @discardableResult
    nonisolated static func removeValueWithoutUserInteraction(for account: String) -> Bool {
        removeValue(for: account)
    }

    nonisolated static func clearAllForTesting() {
        stateLock.lock()
        usesInMemoryStoreForTesting = true
        cachedValues.removeAll()
        protectedValuesForTesting.removeAll()
        legacyValuesForTesting.removeAll()
        protectedWritesFailForTesting = false
        deletesFailForTesting = false
        stateLock.unlock()
    }

    nonisolated static func clearCacheForTesting() {
        stateLock.lock()
        cachedValues.removeAll()
        stateLock.unlock()
    }

    nonisolated static func setLegacyValueForTesting(_ value: String, for account: String) {
        stateLock.lock()
        usesInMemoryStoreForTesting = true
        legacyValuesForTesting[account] = value
        cachedValues.removeValue(forKey: account)
        stateLock.unlock()
    }

    nonisolated static func hasLegacyValueForTesting(for account: String) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return legacyValuesForTesting[account] != nil
    }

    nonisolated static func hasProtectedValueForTesting(for account: String) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return protectedValuesForTesting[account] != nil
    }

    nonisolated static func removeProtectedValueForTesting(
        for account: String,
        preservingCache: Bool = false
    ) {
        stateLock.lock()
        protectedValuesForTesting.removeValue(forKey: account)
        if !preservingCache {
            cachedValues.removeValue(forKey: account)
        }
        stateLock.unlock()
    }

    nonisolated static func setProtectedWritesFailForTesting(_ shouldFail: Bool) {
        stateLock.lock()
        usesInMemoryStoreForTesting = true
        protectedWritesFailForTesting = shouldFail
        stateLock.unlock()
    }

    nonisolated static func setDeletesFailForTesting(_ shouldFail: Bool) {
        stateLock.lock()
        usesInMemoryStoreForTesting = true
        deletesFailForTesting = shouldFail
        stateLock.unlock()
    }

    nonisolated private static func migrateLegacyValue(for account: String) -> String? {
        do {
            guard let value = try readStringStrict(from: .alternate, account: account) else {
                return nil
            }
            guard set(value, for: account) else {
                VoxtLog.securityWarning("Legacy Keychain migration write failed. account=\(account)")
                cache(value, for: account)
                return value
            }
            guard authoritativeData(for: account) == Data(value.utf8) else {
                removeCachedValue(for: account)
                VoxtLog.securityWarning("Legacy Keychain migration verification failed. account=\(account)")
                cache(value, for: account)
                return value
            }
            if !deleteValue(in: .alternate, for: account, interactionAllowed: false) {
                VoxtLog.securityWarning("Legacy Keychain migration cleanup failed. account=\(account)")
            }
            return value
        } catch let StorageError.unexpectedStatus(status)
            where status == errSecInteractionNotAllowed || status == errSecAuthFailed {
            VoxtLog.securityWarning(
                "Legacy Keychain migration requires user interaction; migration deferred. account=\(account), status=\(status)"
            )
            return nil
        } catch {
            VoxtLog.securityWarning(
                "Legacy Keychain read failed. account=\(account), error=\(error.localizedDescription)"
            )
            return nil
        }
    }

    nonisolated private static func authoritativeData(for account: String) -> Data? {
        var query = query(for: .authoritative, account: account, interactionAllowed: true)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else {
            return nil
        }
        return item as? Data
    }

    nonisolated private static var isUsingInMemoryStoreForTesting: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return usesInMemoryStoreForTesting
    }

    nonisolated private static func protectedValueForTesting(for account: String) -> String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return protectedValuesForTesting[account]
    }

    nonisolated private static func legacyValueForTesting(for account: String) -> String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return legacyValuesForTesting[account]
    }

    nonisolated private static func setProtectedValueForTesting(_ value: String, for account: String) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !protectedWritesFailForTesting else { return false }
        protectedValuesForTesting[account] = value
        cachedValues[account] = value
        return true
    }

    nonisolated private static func removeValuesForTesting(for account: String) -> Bool {
        stateLock.lock()
        guard !deletesFailForTesting else {
            stateLock.unlock()
            return false
        }
        protectedValuesForTesting.removeValue(forKey: account)
        legacyValuesForTesting.removeValue(forKey: account)
        stateLock.unlock()
        return true
    }

    nonisolated private static func migrateLegacyValueForTesting(for account: String) -> String? {
        guard let legacyValue = legacyValueForTesting(for: account) else {
            return nil
        }
        guard setProtectedValueForTesting(legacyValue, for: account),
              protectedValueForTesting(for: account) == legacyValue
        else {
            cache(legacyValue, for: account)
            return legacyValue
        }

        _ = deleteLegacyValueForTesting(for: account)
        return legacyValue
    }

    nonisolated private static func deleteLegacyValueForTesting(for account: String) -> Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        guard !deletesFailForTesting else { return false }
        legacyValuesForTesting.removeValue(forKey: account)
        return true
    }

    nonisolated private static func cachedValue(for account: String) -> String? {
        stateLock.lock()
        defer { stateLock.unlock() }
        return cachedValues[account]
    }

    nonisolated private static func cache(_ value: String, for account: String) {
        stateLock.lock()
        cachedValues[account] = value
        stateLock.unlock()
    }

    nonisolated private static func removeCachedValue(for account: String) {
        stateLock.lock()
        cachedValues.removeValue(forKey: account)
        stateLock.unlock()
    }

    /// Keychain backend selection for unsandboxed Developer ID builds.
    /// Prefer Data Protection when available; otherwise use the login keychain.
    private enum KeychainStore: String, CaseIterable, Sendable {
        case dataProtection
        case login

        var usesDataProtectionKeychain: Bool {
            self == .dataProtection
        }
    }

    /// Logical roles:
    /// - authoritative: preferred writable store for this process
    /// - alternate: secondary store used only for migration/cleanup
    private enum KeychainRole: String, Sendable {
        case authoritative
        case alternate
    }

    // Cached after first successful probe so release builds do not keep retrying
    // Data Protection APIs that are unavailable without the related entitlement.
    nonisolated(unsafe) private static var preferredStoreOverride: KeychainStore?

    nonisolated private static var preferredStore: KeychainStore {
        stateLock.lock()
        if let preferredStoreOverride {
            stateLock.unlock()
            return preferredStoreOverride
        }
        stateLock.unlock()

        let resolved = resolvePreferredStore()
        stateLock.lock()
        preferredStoreOverride = resolved
        stateLock.unlock()
        return resolved
    }

    nonisolated private static func resolvePreferredStore() -> KeychainStore {
        // Probe Data Protection with a disposable item. errSecMissingEntitlement
        // (-34018) means this process cannot use DP keychain (typical for the
        // unsandboxed SayIt Developer ID packaging).
        let probeAccount = "voxt.secure-storage.capability-probe"
        var addQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: probeAccount,
            kSecValueData as String: Data("probe".utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecUseDataProtectionKeychain as String: kCFBooleanTrue as Any
        ]
        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecSuccess || addStatus == errSecDuplicateItem {
            var deleteQuery = addQuery
            deleteQuery.removeValue(forKey: kSecValueData as String)
            deleteQuery.removeValue(forKey: kSecAttrAccessible as String)
            _ = SecItemDelete(deleteQuery as CFDictionary)
            return .dataProtection
        }
        if addStatus == errSecMissingEntitlement {
            VoxtLog.securityWarning(
                "Data Protection Keychain unavailable (missing entitlement); using login keychain."
            )
            return .login
        }
        // Any other failure: still try DP first at call sites, but prefer login
        // so credential saves remain usable on unsandboxed builds.
        VoxtLog.securityWarning(
            "Data Protection Keychain probe failed (status=\(addStatus)); preferring login keychain."
        )
        return .login
    }

    nonisolated private static func store(for role: KeychainRole) -> KeychainStore {
        switch role {
        case .authoritative:
            return preferredStore
        case .alternate:
            // Always keep the non-preferred store as alternate so older items
            // can still be found after backend preference flips.
            return preferredStore == .dataProtection ? .login : .dataProtection
        }
    }

    nonisolated private static func query(
        for role: KeychainRole,
        account: String,
        interactionAllowed: Bool
    ) -> [String: Any] {
        query(for: store(for: role), account: account, interactionAllowed: interactionAllowed)
    }

    nonisolated private static func query(
        for store: KeychainStore,
        account: String,
        interactionAllowed: Bool
    ) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: account,
            kSecUseDataProtectionKeychain as String: (
                store.usesDataProtectionKeychain ? kCFBooleanTrue : kCFBooleanFalse
            ) as Any
        ]
        if !interactionAllowed {
            let context = LAContext()
            context.interactionNotAllowed = true
            query[kSecUseAuthenticationContext as String] = context
        }
        return query
    }

    nonisolated private static func readString(from role: KeychainRole, account: String) -> String? {
        (try? readStringStrict(from: role, account: account)) ?? nil
    }

    nonisolated private static func readStringStrict(
        from role: KeychainRole,
        account: String
    ) throws -> String? {
        var query = query(for: role, account: account, interactionAllowed: true)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data,
                  let value = String(data: data, encoding: .utf8)
            else {
                throw StorageError.invalidUTF8
            }
            return value
        case errSecItemNotFound:
            return nil
        case errSecMissingEntitlement:
            // Mark DP unavailable for subsequent calls.
            if store(for: role) == .dataProtection {
                stateLock.lock()
                preferredStoreOverride = .login
                stateLock.unlock()
            }
            throw StorageError.unexpectedStatus(status)
        default:
            throw StorageError.unexpectedStatus(status)
        }
    }

    nonisolated private static func writeString(
        _ value: String,
        to role: KeychainRole,
        account: String
    ) throws {
        let query = query(for: role, account: account, interactionAllowed: true)
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8)
        ]
        let updateStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        switch updateStatus {
        case errSecSuccess:
            return
        case errSecItemNotFound:
            break
        case errSecMissingEntitlement:
            if store(for: role) == .dataProtection {
                stateLock.lock()
                preferredStoreOverride = .login
                stateLock.unlock()
                // Retry once against login keychain.
                try writeString(value, to: role, account: account)
                return
            }
            throw StorageError.unexpectedStatus(updateStatus)
        default:
            throw StorageError.unexpectedStatus(updateStatus)
        }

        var item = query
        item[kSecValueData as String] = Data(value.utf8)
        item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(item as CFDictionary, nil)
        switch addStatus {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            let retryStatus = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            guard retryStatus == errSecSuccess else {
                throw StorageError.unexpectedStatus(retryStatus)
            }
        case errSecMissingEntitlement:
            if store(for: role) == .dataProtection {
                stateLock.lock()
                preferredStoreOverride = .login
                stateLock.unlock()
                try writeString(value, to: role, account: account)
                return
            }
            throw StorageError.unexpectedStatus(addStatus)
        default:
            throw StorageError.unexpectedStatus(addStatus)
        }
    }

    nonisolated private static func hasValue(in role: KeychainRole, account: String) -> Bool {
        var lookup = query(for: role, account: account, interactionAllowed: false)
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        let status = SecItemCopyMatching(lookup as CFDictionary, nil)
        switch status {
        case errSecSuccess:
            return true
        case errSecItemNotFound, errSecInteractionNotAllowed, errSecAuthFailed:
            return false
        case errSecMissingEntitlement:
            if store(for: role) == .dataProtection {
                stateLock.lock()
                preferredStoreOverride = .login
                stateLock.unlock()
            }
            return false
        default:
            VoxtLog.securityWarning(
                "Keychain presence check failed. role=\(role) account=\(account) status=\(status)"
            )
            return false
        }
    }

    @discardableResult
    nonisolated private static func deleteValue(
        in role: KeychainRole,
        for account: String,
        interactionAllowed: Bool
    ) -> Bool {
        let status = SecItemDelete(
            query(for: role, account: account, interactionAllowed: interactionAllowed) as CFDictionary
        )
        guard status == errSecSuccess || status == errSecItemNotFound else {
            // Missing entitlement on the alternate store is not fatal.
            if status == errSecMissingEntitlement {
                return true
            }
            VoxtLog.securityWarning(
                "Keychain delete failed. role=\(role) account=\(account) status=\(status)"
            )
            return false
        }
        return true
    }

    // MARK: - Compatibility wrappers used by tests / call sites

    nonisolated private static func protectedQuery(for account: String) -> [String: Any] {
        // Historical name: "protected" means the Data Protection query shape
        // when available; otherwise the authoritative store query.
        query(for: .authoritative, account: account, interactionAllowed: true)
    }

    /// Always targets the login keychain (non-Data-Protection). Used by tests and
    /// cleanup paths that must not touch Data Protection items.
    nonisolated static func legacyQuery(
        for account: String,
        interactionAllowed: Bool
    ) -> [String: Any] {
        query(for: .login, account: account, interactionAllowed: interactionAllowed)
    }
}
