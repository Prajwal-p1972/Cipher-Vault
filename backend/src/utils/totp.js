import speakeasy from 'speakeasy';

export const TOTP_STEP_SECONDS = 30;

/**
 * Generates a 20-byte TOTP secret and corresponding OTPAuth URL.
 *
 * @param {string} accountLabel - User account label (e.g. email)
 * @param {string} [issuer='Cipher Vault'] - System issuer name
 * @returns {{ base32: string, otpauthUrl: string, manualEntryKey: string }} Secret credentials
 */
export function generateTotpSecret(accountLabel, issuer = 'Cipher Vault') {
  const secret = speakeasy.generateSecret({
    length: 20,
    name: `${issuer}:${accountLabel}`,
    issuer
  });

  const otpauthUrl = speakeasy.otpauthURL({
    secret: secret.base32,
    label: accountLabel,
    issuer,
    encoding: 'base32',
    digits: 6,
    step: TOTP_STEP_SECONDS
  });

  return {
    base32: secret.base32,
    otpauthUrl: secret.otpauth_url || otpauthUrl,
    manualEntryKey: secret.base32
  };
}

/**
 * Verifies a 6-digit TOTP token against a base32 secret with window +/-1.
 *
 * @param {string} base32Secret - The TOTP base32 secret
 * @param {string} token - 6-digit token string
 * @returns {number|null} The matched integer time-step or null if invalid
 */
export function verifyTotp(base32Secret, token, window = 1) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token)) {
    return null;
  }
  if (!base32Secret || typeof base32Secret !== 'string') {
    return null;
  }

  try {
    const verified = speakeasy.totp.verify({
      secret: base32Secret,
      encoding: 'base32',
      token,
      window: 1,
      step: TOTP_STEP_SECONDS
    });

    if (!verified) {
      return null;
    }

    const deltaObj = speakeasy.totp.verifyDelta({
      secret: base32Secret,
      encoding: 'base32',
      token,
      window: 1,
      step: TOTP_STEP_SECONDS
    });

    if (!deltaObj) {
      return null;
    }

    const currentStep = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
    return currentStep + deltaObj.delta;
  } catch {
    return null;
  }
}

/**
 * Compatibility wrapper returning { valid, step }.
 *
 * @param {string} base32Secret - Secret key
 * @param {string} token - Token code
 * @param {number} [window=1] - Verification window
 * @returns {{ valid: boolean, step: number | null }}
 */
export function verifyTotpCode(base32Secret, token, window = 1) {
  const step = verifyTotp(base32Secret, token);
  return { valid: step !== null, step };
}
