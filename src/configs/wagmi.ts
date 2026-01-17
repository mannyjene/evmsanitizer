import { cookieStorage, createStorage } from "@wagmi/core";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { wagmiNetworks } from "@/configs/networks";

// Unused imports removed - they can be re-added if Safe connector is needed:
// import { type CreateConnectorFn } from "@wagmi/core";
// import { safe } from "wagmi/connectors";
// interface SafeConnectorOptions {
//   allowedDomains: Array<RegExp>;
//   debug: boolean;
// }

export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID;

if (!projectId) throw new Error("NEXT_PUBLIC_PROJECT_ID is not defined");

// AppKit will auto-detect browser wallets (MetaMask, Coinbase Wallet, etc.)
// If you want to add Safe connector later, uncomment and add to WagmiAdapter config:
// const connectors: Array<CreateConnectorFn> = [
//   safe({
//     allowedDomains: [/^.*$/],
//     debug: false,
//   } as SafeConnectorOptions),
// ];

export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks: wagmiNetworks as Array<AppKitNetwork>,
  // Connectors not specified - AppKit will auto-detect browser wallets
  batch: {
    multicall: true,
  },
});

export const config = wagmiAdapter.wagmiConfig;
