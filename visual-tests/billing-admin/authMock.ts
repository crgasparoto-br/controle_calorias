export function useAuth() {
  return {
    loading: false,
    user: {
      id: 1,
      name: "Administrador de validação",
      email: "admin@example.com",
      role: "admin",
      professionalProfileActive: false,
    },
    refresh: async () => undefined,
    logout: async () => undefined,
  };
}
