export function useAuth() {
  return {
    loading: false,
    user: {
      id: 1,
      name: "Nutricionista de validação",
      professionalProfileActive: true,
    },
    refresh: async () => undefined,
  };
}
