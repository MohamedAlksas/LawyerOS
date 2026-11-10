import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'نظام إدارة مكتب المحاماة | LawOffice OS',
  description: 'نظام رقمي متكامل لإدارة ملفات القضايا والجلسات والحسابات لمكتب المحاماة',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar-EG" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
