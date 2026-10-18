import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
const Resend = vi.fn(function () {
    return { emails: { send } };
});
vi.mock('resend', () => ({ Resend }));

const originalEnv = { ...process.env };

// The transport is picked when the module loads, so reload it after setting the env
const loadEmailModules = async (env: Record<string, string | undefined>) => {
    process.env = { ...originalEnv, NODEMAILER_EMAIL: 'gmail@example.com', NODEMAILER_PASSWORD: 'secret', ...env };
    vi.resetModules();
    return {
        ...(await import('@/lib/nodemailer')),
        ...(await import('@/lib/nodemailer/reset-password')),
    };
};

describe('email through Resend', () => {
    beforeEach(() => {
        send.mockReset();
        Resend.mockClear();
        send.mockResolvedValue({ data: { id: 'resend-1' }, error: null });
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    it('sends the welcome email from EMAIL_FROM when RESEND_API_KEY is set', async () => {
        const { sendWelcomeEmail } = await loadEmailModules({
            RESEND_API_KEY: 're_test',
            EMAIL_FROM: 'OpenStock <noreply@groats.dev>',
        });

        const result = await sendWelcomeEmail({ email: 'user@example.com', name: 'Ada', intro: 'Hi' });

        expect(Resend).toHaveBeenCalledWith('re_test');
        expect(send).toHaveBeenCalledTimes(1);
        const [options] = send.mock.calls[0];
        expect(options).toMatchObject({ from: 'OpenStock <noreply@groats.dev>', to: 'user@example.com' });
        expect(options.subject).toContain('Welcome to Openstock');
        expect(options.html).toContain('Ada');
        expect(result).toEqual({ status: 'sent', messageId: 'resend-1' });
    });

    it('sends the password reset email through Resend', async () => {
        const { sendPasswordResetEmail } = await loadEmailModules({
            RESEND_API_KEY: 're_test',
            EMAIL_FROM: 'OpenStock <noreply@groats.dev>',
        });

        const info = await sendPasswordResetEmail({ email: 'user@example.com', name: 'Ada', resetUrl: 'https://example.com/r?t=1' });

        const [options] = send.mock.calls[0];
        expect(options).toMatchObject({ from: 'OpenStock <noreply@groats.dev>', subject: 'Reset your Openstock password' });
        expect(options.text).toContain('https://example.com/r?t=1');
        expect(info).toEqual({ messageId: 'resend-1' });
    });

    it('throws when Resend returns an error', async () => {
        const { sendNewsSummaryEmail } = await loadEmailModules({
            RESEND_API_KEY: 're_test',
            EMAIL_FROM: 'OpenStock <noreply@groats.dev>',
        });
        vi.spyOn(console, 'error').mockImplementation(() => {});
        send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'domain not verified' } });

        await expect(
            sendNewsSummaryEmail({ email: 'user@example.com', date: 'today', newsContent: '<p>news</p>' })
        ).rejects.toThrow('Resend failed to send email: domain not verified');
    });

    it('logs an error and skips sending when EMAIL_FROM is missing', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { sendWelcomeEmail, isEmailConfigured } = await loadEmailModules({
            RESEND_API_KEY: 're_test',
            EMAIL_FROM: undefined,
        });

        const result = await sendWelcomeEmail({ email: 'user@example.com', name: 'Ada', intro: 'Hi' });

        expect(isEmailConfigured).toBe(false);
        expect(result).toEqual({ status: 'skipped' });
        expect(send).not.toHaveBeenCalled();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('EMAIL_FROM is missing'));
        expect(error.mock.calls.flat().join(' ')).not.toContain('re_test');
    });

    it('warns only when neither Resend nor nodemailer is configured', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { isEmailConfigured } = await loadEmailModules({
            RESEND_API_KEY: undefined,
            NODEMAILER_EMAIL: undefined,
            NODEMAILER_PASSWORD: undefined,
        });

        expect(isEmailConfigured).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('Email is not configured'));
        expect(Resend).not.toHaveBeenCalled();
    });
});
