export const fakeDb = {
  user: {
    create: (data: { name: string }) => ({ id: "local-1", ...data }),
    findMany: () => [{ id: "local-1", name: "example" }],
  },
};
