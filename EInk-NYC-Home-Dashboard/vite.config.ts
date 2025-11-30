import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  base: "./", // Use relative paths
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    {
      name: "geojson-loader",

      transform(code, id) {
        if (id.endsWith(".geojson")) {
          return {
            code: `export default ${code}`,
            map: null,
          };
        }
      },
    },
  ],
});
