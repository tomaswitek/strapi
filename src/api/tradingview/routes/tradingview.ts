export default {
  routes: [
    {
      method: "POST",
      path: "/tradingview/:slug",
      handler: "tradingview.parseAlert",
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
