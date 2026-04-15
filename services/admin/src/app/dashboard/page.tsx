export default function DashboardPage(): JSX.Element {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">📊 Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Usuários Ativos" value="--" icon="👥" color="blue" />
        <StatCard title="Refeições Hoje" value="--" icon="🍽️" color="green" />
        <StatCard title="Mensagens Processadas" value="--" icon="💬" color="purple" />
        <StatCard title="Taxa de Confirmação" value="--%" icon="✅" color="yellow" />
      </div>
      <div className="mt-8 bg-white rounded-xl shadow p-6">
        <h2 className="text-xl font-semibold mb-4">Atividade Recente</h2>
        <p className="text-gray-500 text-center py-8">
          Conecte a API para visualizar dados reais
        </p>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string;
  icon: string;
  color: 'blue' | 'green' | 'purple' | 'yellow';
}): JSX.Element {
  const colorMap = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    purple: 'bg-purple-50 border-purple-200',
    yellow: 'bg-yellow-50 border-yellow-200',
  };

  return (
    <div className={`rounded-xl border p-6 ${colorMap[color]}`}>
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-gray-600 text-sm">{title}</div>
    </div>
  );
}
