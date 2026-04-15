import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Controle Calorias - Admin',
  description: 'Painel administrativo do Controle Calorias SaaS',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="pt-BR">
      <body className="bg-gray-50 text-gray-900">{children}</body>
    </html>
  );
}
