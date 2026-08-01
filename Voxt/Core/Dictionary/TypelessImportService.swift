// TypelessImportService.swift
// One-click import of personal dictionary terms from the Typeless desktop app.

import Foundation
import CommonCrypto

enum TypelessImportError: LocalizedError, Equatable {
    case sessionNotFound
    case sessionInvalid
    case sessionExpired
    case apiFailed(String?)
    case platformUnsupported
    case cryptoFailed
    case homeNotFound
    case timeInvalid

    var errorDescription: String? {
        switch self {
        case .sessionNotFound:
            return AppLocalization.localizedString("Typeless session not found. Open Typeless and sign in first.")
        case .sessionInvalid:
            return AppLocalization.localizedString("Typeless session data is invalid.")
        case .sessionExpired:
            return AppLocalization.localizedString("Typeless session expired. Sign in to Typeless again.")
        case .apiFailed(let detail):
            if let detail, !detail.isEmpty {
                return AppLocalization.format("Typeless dictionary import failed: %@", detail)
            }
            return AppLocalization.localizedString("Typeless dictionary import failed.")
        case .platformUnsupported:
            return AppLocalization.localizedString("Typeless import is only supported on macOS.")
        case .cryptoFailed:
            return AppLocalization.localizedString("Typeless session decryption failed.")
        case .homeNotFound:
            return AppLocalization.localizedString("Unable to locate the user home directory.")
        case .timeInvalid:
            return AppLocalization.localizedString("Typeless dictionary import failed.")
        }
    }
}

struct TypelessImportResult: Equatable {
    let fetched: Int
    let added: Int
    let skipped: Int
}

enum TypelessImportService {
    private static let apiBase = "https://api.typeless.com"
    private static let appVersion = "mac_1.3.0"
    private static let hmacKey = "9088eaec863c54571b4f28f6535b5f2526be3f5015791e659e4bdb31"
    private static let aesPassword = "46d40fe4218b857cae25f9c01c2664a98833fc69a0fda798c709fd1f"
    private static let clientURL =
        "file:///Applications/Typeless.app/Contents/Resources/app.asar/dist/renderer/hub.html"
    private static let userAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Typeless/1.3.0 Chrome/130.0.6723.191 Electron/33.4.11 Safari/537.36"
    private static let pageSize = 200

    static func fetchTypelessTerms() async throws -> [String] {
        #if os(macOS)
        let user = try decryptUserData()
        let deviceID = loadDeviceID()
        return try await fetchAllTerms(user: user, deviceID: deviceID)
        #else
        throw TypelessImportError.platformUnsupported
        #endif
    }

    @MainActor
    static func importTerms(into store: DictionaryStore) async throws -> TypelessImportResult {
        let terms = try await fetchTypelessTerms()
        let category = try resolveTypelessCategory(in: store)
        let importResult = store.importHotwordTerms(
            terms,
            categoryID: category.id,
            categoryNameSnapshot: category.name,
            source: .manual
        )
        // Treat reinforced existing terms as skipped duplicates for UI messaging.
        let skipped = importResult.skippedCount + importResult.reinforcedCount
        return TypelessImportResult(
            fetched: terms.count,
            added: importResult.addedCount,
            skipped: skipped
        )
    }

    @MainActor
    private static func resolveTypelessCategory(in store: DictionaryStore) throws -> DictionaryCategory {
        let targetName = "Typeless"
        let normalized = DictionaryStore.normalizeTerm(targetName)
        if let existing = store.categories.first(where: { $0.normalizedName == normalized }) {
            return existing
        }
        do {
            return try store.createCategory(name: targetName)
        } catch DictionaryStoreError.duplicateCategory {
            if let existing = store.categories.first(where: { $0.normalizedName == normalized }) {
                return existing
            }
            return store.categories.first(where: \.isDefault) ?? DictionaryCategory.defaultCategory
        }
    }

    // MARK: - Session

    private struct ElectronStoreData: Decodable {
        let userData: String
    }

    private struct TypelessUserData: Decodable {
        let refreshToken: String
        let userID: String

        enum CodingKeys: String, CodingKey {
            case refreshToken = "refresh_token"
            case userID = "user_id"
        }
    }

    private static func typelessDirectory() throws -> URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        guard !home.path.isEmpty else {
            throw TypelessImportError.homeNotFound
        }
        return home
            .appendingPathComponent("Library/Application Support/Typeless", isDirectory: true)
    }

    private static func decryptUserData() throws -> TypelessUserData {
        let path = try typelessDirectory().appendingPathComponent("user-data.json")
        let raw: Data
        do {
            raw = try Data(contentsOf: path)
        } catch {
            throw TypelessImportError.sessionNotFound
        }

        guard raw.count >= 18, raw[16] == UInt8(ascii: ":") else {
            throw TypelessImportError.sessionInvalid
        }

        let iv = raw.prefix(16)
        let ciphertext = raw.dropFirst(17)
        let ivSalt = String(decoding: iv, as: UTF8.self)

        let currentKey = try currentEncryptionKey()
        let password = try pbkdf2(
            password: currentKey,
            salt: Data(ivSalt.utf8),
            prf: CCPBKDFAlgorithm(kCCPRFHmacAlgSHA512)
        )

        let decrypted: Data
        do {
            decrypted = try aesCBC(
                operation: CCOperation(kCCDecrypt),
                data: Data(ciphertext),
                key: password,
                iv: Data(iv)
            )
        } catch {
            throw TypelessImportError.sessionInvalid
        }

        let store: ElectronStoreData
        do {
            store = try JSONDecoder().decode(ElectronStoreData.self, from: decrypted)
        } catch {
            throw TypelessImportError.sessionInvalid
        }

        guard let userData = store.userData.data(using: .utf8) else {
            throw TypelessImportError.sessionInvalid
        }

        do {
            return try JSONDecoder().decode(TypelessUserData.self, from: userData)
        } catch {
            throw TypelessImportError.sessionInvalid
        }
    }

    private static func loadDeviceID() -> String {
        let path = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/now.typeless.desktop/device.cache")
        guard let text = try? String(contentsOf: path, encoding: .utf8) else {
            return "UNKNOWN"
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "UNKNOWN" : trimmed
    }

    private static func currentEncryptionKey() throws -> Data {
        let arch: String
        #if arch(arm64)
        arch = "arm64"
        #elseif arch(x86_64)
        arch = "x64"
        #else
        arch = "unknown"
        #endif
        let platformHash = hex(sha256(Data("darwin-\(arch)".utf8)))
        return try pbkdf2(
            password: Data("\(platformHash)Typeless".utf8),
            salt: Data("typeless-user-service".utf8),
            prf: CCPBKDFAlgorithm(kCCPRFHmacAlgSHA256)
        )
    }

    // MARK: - API

    private static func fetchAllTerms(user: TypelessUserData, deviceID: String) async throws -> [String] {
        var terms: [String] = []
        var offset = 0
        let session = URLSession.shared

        while true {
            let path = "/user/dictionary/list"
            guard var components = URLComponents(string: "\(apiBase)\(path)") else {
                throw TypelessImportError.apiFailed(nil)
            }
            components.queryItems = [
                URLQueryItem(name: "size", value: String(pageSize)),
                URLQueryItem(name: "offset", value: String(offset))
            ]
            guard let url = components.url else {
                throw TypelessImportError.apiFailed(nil)
            }

            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.timeoutInterval = 20
            for (name, value) in try securityHeaders(user: user, path: path, deviceID: deviceID) {
                request.setValue(value, forHTTPHeaderField: name)
            }

            let data: Data
            let response: URLResponse
            do {
                (data, response) = try await session.data(for: request)
            } catch {
                throw TypelessImportError.apiFailed(nil)
            }

            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                if statusCode == 401 {
                    throw TypelessImportError.sessionExpired
                }
                throw TypelessImportError.apiFailed("HTTP_\(statusCode)")
            }

            let status = body["status"] as? String
            if statusCode < 200 || statusCode >= 300 || status != "OK" {
                if statusCode == 401 {
                    throw TypelessImportError.sessionExpired
                }
                throw TypelessImportError.apiFailed("HTTP_\(statusCode)")
            }

            let dataObject = body["data"] as? [String: Any]
            let words = dataObject?["words"] as? [[String: Any]] ?? []
            let totalCount: Int
            if let total = dataObject?["total_count"] as? Int {
                totalCount = total
            } else if let total = dataObject?["total_count"] as? NSNumber {
                totalCount = total.intValue
            } else {
                totalCount = words.count
            }

            for word in words {
                if let term = word["term"] as? String {
                    let trimmed = term.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty {
                        terms.append(trimmed)
                    }
                }
            }

            if terms.count >= totalCount || words.isEmpty {
                break
            }
            offset += pageSize
        }

        return terms
    }

    private static func securityHeaders(
        user: TypelessUserData,
        path: String,
        deviceID: String
    ) throws -> [(String, String)] {
        let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
        let signStr = "\(timestamp):\(appVersion):\(path):\(user.userID)"
        let sha1Key = "\(timestamp):\(hmacKey)"
        let signature = hex(hmacSHA1(key: Data(sha1Key.utf8), data: Data(signStr.utf8)))

        var salt = [UInt8](repeating: 0, count: 8)
        let randomStatus = SecRandomCopyBytes(kSecRandomDefault, salt.count, &salt)
        guard randomStatus == errSecSuccess else {
            throw TypelessImportError.cryptoFailed
        }

        var randomSeed = [UInt8](repeating: 0, count: 4)
        _ = SecRandomCopyBytes(kSecRandomDefault, randomSeed.count, &randomSeed)
        let randomNumber = 100_000 + (UInt32(bigEndian: randomSeed.withUnsafeBytes { $0.load(as: UInt32.self) }) % 900_000)

        let payload: [String: Any] = [
            "X-Env": "prod",
            "X-Client-Domain": clientURL,
            "X-Client-Path": clientURL,
            "X-Random": String(randomNumber),
            "t": timestamp,
            "p": signature,
            "d": deviceID,
            "3c86e26ccbb7274f752e7d868a1541ebfb7f37e7": ["a": ""]
        ]

        guard JSONSerialization.isValidJSONObject(payload),
              let payloadData = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let payloadString = String(data: payloadData, encoding: .utf8)
        else {
            throw TypelessImportError.cryptoFailed
        }

        let xAuthorization = try cryptoJSAESEncrypt(plaintext: payloadString, salt: Data(salt))

        return [
            ("Authorization", "Bearer \(user.refreshToken)"),
            ("Content-Type", "application/json"),
            ("X-App-Version", appVersion),
            ("X-Authorization", xAuthorization),
            ("X-Browser-Major", "130"),
            ("X-Browser-Name", "Chrome"),
            ("X-Browser-Version", "130.0.6723.191"),
            ("User-Agent", userAgent)
        ]
    }

    // MARK: - Crypto helpers

    private static func pbkdf2(password: Data, salt: Data, prf: CCPBKDFAlgorithm) throws -> Data {
        var derived = Data(count: kCCKeySizeAES256)
        let status = derived.withUnsafeMutableBytes { derivedBytes in
            password.withUnsafeBytes { passwordBytes in
                salt.withUnsafeBytes { saltBytes in
                    CCKeyDerivationPBKDF(
                        CCPBKDFAlgorithm(kCCPBKDF2),
                        passwordBytes.bindMemory(to: Int8.self).baseAddress,
                        password.count,
                        saltBytes.bindMemory(to: UInt8.self).baseAddress,
                        salt.count,
                        prf,
                        10_000,
                        derivedBytes.bindMemory(to: UInt8.self).baseAddress,
                        kCCKeySizeAES256
                    )
                }
            }
        }
        guard status == kCCSuccess else {
            throw TypelessImportError.cryptoFailed
        }
        return derived
    }

    private static func sha256(_ data: Data) -> Data {
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { buffer in
            _ = CC_SHA256(buffer.baseAddress, CC_LONG(data.count), &digest)
        }
        return Data(digest)
    }

    private static func md5(_ data: Data) -> Data {
        var digest = [UInt8](repeating: 0, count: Int(CC_MD5_DIGEST_LENGTH))
        data.withUnsafeBytes { buffer in
            _ = CC_MD5(buffer.baseAddress, CC_LONG(data.count), &digest)
        }
        return Data(digest)
    }

    private static func hmacSHA1(key: Data, data: Data) -> Data {
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
        key.withUnsafeBytes { keyBytes in
            data.withUnsafeBytes { dataBytes in
                CCHmac(
                    CCHmacAlgorithm(kCCHmacAlgSHA1),
                    keyBytes.baseAddress,
                    key.count,
                    dataBytes.baseAddress,
                    data.count,
                    &digest
                )
            }
        }
        return Data(digest)
    }

    private static func aesCBC(
        operation: CCOperation,
        data: Data,
        key: Data,
        iv: Data
    ) throws -> Data {
        var output = Data(count: data.count + kCCBlockSizeAES128)
        var moved = 0
        let status = output.withUnsafeMutableBytes { outputBytes in
            data.withUnsafeBytes { dataBytes in
                key.withUnsafeBytes { keyBytes in
                    iv.withUnsafeBytes { ivBytes in
                        CCCrypt(
                            operation,
                            CCAlgorithm(kCCAlgorithmAES),
                            CCOptions(kCCOptionPKCS7Padding),
                            keyBytes.baseAddress,
                            key.count,
                            ivBytes.baseAddress,
                            dataBytes.baseAddress,
                            data.count,
                            outputBytes.baseAddress,
                            data.count + kCCBlockSizeAES128,
                            &moved
                        )
                    }
                }
            }
        }
        guard status == kCCSuccess else {
            throw TypelessImportError.cryptoFailed
        }
        output.count = moved
        return output
    }

    /// OpenSSL/CryptoJS EVP_BytesToKey (MD5) for AES-256 + 16-byte IV.
    private static func evpBytesToKey(password: Data, salt: Data) -> (key: Data, iv: Data) {
        var derived = Data()
        var previous = Data()
        while derived.count < 48 {
            var input = previous
            input.append(password)
            input.append(salt)
            previous = md5(input)
            derived.append(previous)
        }
        return (derived.prefix(32), derived.dropFirst(32).prefix(16))
    }

    private static func cryptoJSAESEncrypt(plaintext: String, salt: Data) throws -> String {
        let (key, iv) = evpBytesToKey(password: Data(aesPassword.utf8), salt: salt)
        let encrypted = try aesCBC(
            operation: CCOperation(kCCEncrypt),
            data: Data(plaintext.utf8),
            key: Data(key),
            iv: Data(iv)
        )
        var output = Data("Salted__".utf8)
        output.append(salt)
        output.append(encrypted)
        return output.base64EncodedString()
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}
