import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const transporter = { sendMail: vi.fn() };
    return { transporter, current: transporter as typeof transporter | null };
});

vi.mock('@/lib/nodemailer', () => ({
    get transporter() {
        return mocks.current;
    },
}));

import { sendPasswordResetEmail } from '@/lib/nodemailer/reset-password';

describe('sendPasswordResetEmail', () => {
    const sendMailMock = mocks.transporter.sendMail;

    beforeEach(() => {
        mocks.current = mocks.transporter;
        sendMailMock.mockReset();
        sendMailMock.mockResolvedValue({ messageId: 'msg-123' });
    });

    it('escapes interpolated values before building the HTML email', async () => {
        await sendPasswordResetEmail({
            email: 'user@example.com',
            name: '<Admin&Co.>',
            resetUrl: 'https://example.com/reset-password?token=a b&next=<script>',
        });

        expect(sendMailMock).toHaveBeenCalledTimes(1);
        const [mailOptions] = sendMailMock.mock.calls[0];

        expect(mailOptions.html).toContain('Hi &lt;Admin&amp;Co.&gt;,');
        expect(mailOptions.html).toContain('href="https://example.com/reset-password?token=a%20b&amp;next=%3Cscript%3E"');
        expect(mailOptions.html).not.toContain('<script>');
        expect(mailOptions.text).toContain('https://example.com/reset-password?token=a%20b&next=%3Cscript%3E');
    });

    it('keeps the already-encoded callbackURL from Better Auth intact', async () => {
        const resetUrl = 'http://localhost:3000/api/auth/reset-password/abc123?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Freset-password';
        await sendPasswordResetEmail({ email: 'user@example.com', name: 'User', resetUrl });

        const [mailOptions] = sendMailMock.mock.calls[0];
        expect(mailOptions.html).toContain(`href="${resetUrl}"`);
        expect(mailOptions.text).toContain(resetUrl);
        expect(mailOptions.html).not.toContain('%253A');
    });

    it('throws when no email transport is configured', async () => {
        mocks.current = null;

        await expect(
            sendPasswordResetEmail({
                email: 'user@example.com',
                name: 'User',
                resetUrl: 'https://example.com/reset-password?token=test',
            })
        ).rejects.toThrow('Email credentials not configured');
    });
});
