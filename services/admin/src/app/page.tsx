export default function HomePage(): JSX.Element {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-green-600 mb-4">🥗 Controle Calorias</h1>
        <p className="text-gray-600 mb-8">Painel Administrativo</p>
        <a
          href="/dashboard"
          className="bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition-colors"
        >
          Acessar Dashboard
        </a>
      </div>
    </main>
  );
}
