import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import {
    WELCOME_EMAIL_TEMPLATE,
    NEWS_SUMMARY_EMAIL_TEMPLATE,
    STOCK_ALERT_UPPER_EMAIL_TEMPLATE,
    STOCK_ALERT_LOWER_EMAIL_TEMPLATE,
} from "@/lib/nodemailer/templates";
import { escapeHtml, formatPrice, sanitizeEmailIntro } from "@/lib/utils";

type EmailSendResult =
    | { status: 'skipped' }
    | { status: 'sent'; messageId: string };

type MailOptions = { from: string; to: string; subject: string; text: string; html: string };
type MailTransport = { sendMail: (options: MailOptions) => Promise<{ messageId: string }> };

const resendApiKey = process.env.RESEND_API_KEY;
const emailFrom = process.env.EMAIL_FROM?.trim();
const hasNodemailerConfig = Boolean(process.env.NODEMAILER_EMAIL && process.env.NODEMAILER_PASSWORD);

// Resend sends over HTTPS, for hosts that block outbound SMTP (e.g. Railway without Pro)
const createResendTransport = (apiKey: string, from: string): MailTransport => {
    const resend = new Resend(apiKey);
    return {
        // The callers' Gmail `from` is ignored: Resend only accepts addresses on a verified domain
        sendMail: async ({ to, subject, text, html }) => {
            const { data, error } = await resend.emails.send({ from, to, subject, text, html });
            if (error || !data) {
                throw new Error(`Resend failed to send email: ${error?.message ?? 'no response data'}`);
            }
            return { messageId: data.id };
        },
    };
};

const createNodemailerTransport = (): MailTransport => {
    const gmail = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.NODEMAILER_EMAIL!,
            pass: process.env.NODEMAILER_PASSWORD!,
        },
        // Keep the pool small because email volume is low in this app.
        pool: true,
        maxConnections: 1,
        maxMessages: 3,
    });
    gmail.verify((error) => {
        if (error) {
            console.error('❌ Nodemailer transporter verification failed:', error);
        } else {
            console.log('✅ Nodemailer transporter is ready to send emails');
        }
    });
    return gmail;
};

const createTransport = (): MailTransport | null => {
    if (resendApiKey) {
        if (!emailFrom) {
            console.error('❌ RESEND_API_KEY is set but EMAIL_FROM is missing. Emails are disabled until EMAIL_FROM is set (e.g. "OpenStock <noreply@yourdomain.com>").');
            return null;
        }
        console.log('✅ Resend is configured to send emails');
        return createResendTransport(resendApiKey, emailFrom);
    }
    if (hasNodemailerConfig) return createNodemailerTransport();
    console.warn('⚠️ Email is not configured. Welcome, alert, news summary and password reset emails are disabled until RESEND_API_KEY and EMAIL_FROM (or NODEMAILER_EMAIL and NODEMAILER_PASSWORD) are set.');
    return null;
};

export const transporter = createTransport();

export const isEmailConfigured = transporter !== null;

export const sendWelcomeEmail = async ({ email, name, intro }: WelcomeEmailData) => {
    try {
        if (!transporter) {
            console.warn('⚠️ Welcome email skipped: email credentials are not configured.');
            return { status: 'skipped' } satisfies EmailSendResult;
        }

        // Function replacements: a string would expand $& or $' inside the name
        const htmlTemplate = WELCOME_EMAIL_TEMPLATE
            .replace('{{name}}', () => escapeHtml(name))
            .replace('{{intro}}', () => sanitizeEmailIntro(intro));

        const mailOptions = {
            from: `"Openstock" <${process.env.NODEMAILER_EMAIL}>`,
            to: email,
            subject: `Welcome to Openstock - your open-source stock market toolkit!`,
            text: 'Thanks for joining Openstock, an initiative by open dev society',
            html: htmlTemplate,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Welcome email sent successfully:', info.messageId);
        return { status: 'sent', messageId: info.messageId } satisfies EmailSendResult;
    } catch (error) {
        console.error('❌ Failed to send welcome email:', error);
        throw error;
    }
}

export const sendNewsSummaryEmail = async (
    { email, date, newsContent }: { email: string; date: string; newsContent: string }
) => {
    try {
        if (!transporter) {
            console.warn('⚠️ News summary email skipped: email credentials are not configured.');
            return { status: 'skipped' } satisfies EmailSendResult;
        }

        const htmlTemplate = NEWS_SUMMARY_EMAIL_TEMPLATE
            .replace('{{date}}', date)
            .replace('{{newsContent}}', newsContent);

        const mailOptions = {
            from: `"Openstock" <${process.env.NODEMAILER_EMAIL}>`,
            to: email,
            subject: `📈 Market News Summary Today - ${date}`,
            text: `Today's market news summary from Openstock`,
            html: htmlTemplate,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ News summary email sent successfully:', info.messageId);
        return { status: 'sent', messageId: info.messageId } satisfies EmailSendResult;
    } catch (error) {
        console.error('❌ Failed to send news summary email:', error);
        throw error;
    }
};

export const sendStockAlertEmail = async (
    { email, symbol, currentPrice, targetPrice, condition }:
    { email: string; symbol: string; currentPrice: number; targetPrice: number; condition: 'ABOVE' | 'BELOW' }
) => {
    try {
        if (!transporter) {
            console.warn('⚠️ Stock alert email skipped: email credentials are not configured.');
            return { status: 'skipped' } satisfies EmailSendResult;
        }

        const isUpper = condition === 'ABOVE';
        // Binance pairs are quoted in USDT, everything else Finnhub prices here is USD
        const money = (value: number) => symbol.startsWith('BINANCE:')
            ? `${value.toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 6 : 2 })} USDT`
            : formatPrice(value);
        const htmlTemplate = (isUpper ? STOCK_ALERT_UPPER_EMAIL_TEMPLATE : STOCK_ALERT_LOWER_EMAIL_TEMPLATE)
            .replaceAll('{{symbol}}', escapeHtml(symbol))
            .replaceAll('{{company}}', '') // Alerts don't store the company name
            .replaceAll('{{currentPrice}}', money(currentPrice))
            .replaceAll('{{targetPrice}}', money(targetPrice))
            .replaceAll('{{timestamp}}', new Date().toUTCString());

        const mailOptions = {
            from: `"Openstock" <${process.env.NODEMAILER_EMAIL}>`,
            to: email,
            subject: `🔔 Price Alert: ${symbol} is ${isUpper ? 'above' : 'below'} ${money(targetPrice)}`,
            text: `${symbol} is now ${money(currentPrice)}, ${isUpper ? 'above' : 'below'} your target of ${money(targetPrice)}.`,
            html: htmlTemplate,
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Stock alert email sent successfully:', info.messageId);
        return { status: 'sent', messageId: info.messageId } satisfies EmailSendResult;
    } catch (error) {
        console.error('❌ Failed to send stock alert email:', error);
        throw error;
    }
};
