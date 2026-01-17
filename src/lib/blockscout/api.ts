import type { Token } from "@/types/tokens";
import type { SupportedChain } from "@/types/networks";
import { formatBalance } from "@/lib/blockscout/utils";
import type { BlockscoutResponse, BlockscoutTokenItem } from "@/types/api/blockscout";
import { appConfig } from "@/configs/app";
import { TOKENS_MOCK } from "@/utils/mocks/tokens";

// Chain ID mapping for Etherscan API v2
// Ethereum=1, Base=8453, BSC=56, Arbitrum=42161, Optimism=10, etc.
const ETHERSCAN_SUPPORTED_CHAINS = [1, 8453]; // Ethereum, Base

// Helper to fetch from Etherscan API v2 for supported chains
async function fetchFromEtherscan(
  address: string,
  chainId: number,
  apiKey: string
): Promise<BlockscoutResponse> {
  try {
    // Try Etherscan API v2 endpoint with chainid parameter
    const v2Url = `https://api.etherscan.io/api/v2/accounts/${address}/tokens?chainid=${chainId}&apikey=${apiKey}`;
    console.log("[fetchTokens] Trying Etherscan API v2:", v2Url, `(chainId: ${chainId})`);

    const v2Response = await fetch(v2Url);
    if (v2Response.ok) {
      const v2Data = await v2Response.json();
      // Check if response has items array (Blockscout format)
      if (v2Data?.items && Array.isArray(v2Data.items)) {
        return v2Data as BlockscoutResponse;
      }
      // If response is different format, convert it
      if (v2Data?.data && Array.isArray(v2Data.data)) {
        return {
          items: v2Data.data.map(
            (token: {
              contractAddress?: string;
              address?: string;
              decimals?: number | string;
              price?: number | string;
              logo?: string;
              name?: string;
              symbol?: string;
              holders?: number | string;
              totalSupply?: number | string;
              marketCap?: number | string;
              balance?: string;
              tokenBalance?: string;
            }) => ({
              token: {
                address: token.contractAddress || token.address,
                decimals: token.decimals?.toString() || "18",
                exchange_rate: token.price?.toString() || null,
                icon_url: token.logo || null,
                name: token.name || "",
                symbol: token.symbol || "",
                type: "ERC-20",
                holders: token.holders?.toString() || "0",
                total_supply: token.totalSupply?.toString() || "0",
                circulating_market_cap: token.marketCap?.toString() || null,
                volume_24h: null,
              },
              token_id: null,
              token_instance: null,
              value: token.balance || token.tokenBalance || "0",
            })
          ),
        };
      }
    }

    // Fallback to Etherscan API v1 - get unique tokens from transactions, then fetch balances
    // Note: Etherscan v1 API endpoints vary by chain (different base URLs)
    const etherscanBaseUrls: Record<number, string> = {
      1: "https://api.etherscan.io", // Ethereum
      8453: "https://api.basescan.org", // Base
    };

    const baseUrl = etherscanBaseUrls[chainId] || "https://api.etherscan.io";
    console.log(
      "[fetchTokens] Etherscan v2 failed, trying v1 token transactions...",
      `(chainId: ${chainId}, baseUrl: ${baseUrl})`
    );
    const v1TxUrl =
      `${baseUrl}/api?module=account&action=tokentx&address=${address}` +
      `&startblock=0&endblock=99999999&sort=desc&page=1&offset=10000&apikey=${apiKey}`;
    const v1TxResponse = await fetch(v1TxUrl);
    if (!v1TxResponse.ok) {
      throw new Error(`Etherscan v1 API error: ${v1TxResponse.status}`);
    }

    const v1TxData = await v1TxResponse.json();
    if (v1TxData.status !== "1" || !v1TxData.result || !Array.isArray(v1TxData.result)) {
      throw new Error(`Etherscan API error: ${v1TxData.message || "Unknown error"}`);
    }

    // Get unique token addresses from transactions (preserve original address case)
    type TokenInfo = {
      originalAddress: string;
      decimals: string;
      symbol: string;
      name: string;
    };
    const tokenAddresses = new Map<string, TokenInfo>();
    for (const tx of v1TxData.result) {
      if (tx.contractAddress) {
        const addrLower = tx.contractAddress.toLowerCase();
        if (!tokenAddresses.has(addrLower)) {
          tokenAddresses.set(addrLower, {
            originalAddress: tx.contractAddress, // Preserve original case for API calls
            decimals: tx.tokenDecimal || "18",
            symbol: tx.tokenSymbol || "",
            name: tx.tokenName || "",
          });
        }
      }
    }

    // Fetch current balances for all unique tokens using tokenbalancemulti endpoint
    const tokenList = Array.from(tokenAddresses.entries());
    const tokenItems: Array<BlockscoutTokenItem> = [];

    // Etherscan allows up to 20 token addresses per balancemulti call
    const batchSize = 20;
    for (let i = 0; i < tokenList.length; i += batchSize) {
      const batch = tokenList.slice(i, i + batchSize);
      const contractAddresses = batch.map(([_, info]) => info.originalAddress).join(",");
      const balanceUrl =
        `${baseUrl}/api?module=account&action=tokenbalancemulti` +
        `&address=${address}&contractaddresses=${contractAddresses}&tag=latest&apikey=${apiKey}`;

      const balanceResponse = await fetch(balanceUrl);
      if (balanceResponse.ok) {
        const balanceData = await balanceResponse.json();
        if (balanceData.status === "1" && Array.isArray(balanceData.result)) {
          for (let j = 0; j < batch.length && j < balanceData.result.length; j++) {
            const [_tokenAddrLower, tokenInfo] = batch[j];
            const balance = BigInt(balanceData.result[j] || "0");
            if (balance > BigInt(0)) {
              tokenItems.push({
                token: {
                  address: tokenInfo.originalAddress, // Use original address with proper casing
                  decimals: tokenInfo.decimals,
                  symbol: tokenInfo.symbol,
                  name: tokenInfo.name,
                  type: "ERC-20",
                  exchange_rate: null,
                  icon_url: null,
                  holders: "0",
                  total_supply: "0",
                  circulating_market_cap: null,
                  volume_24h: null,
                },
                token_id: null,
                token_instance: null,
                value: balance.toString(),
              });
            }
          }
        }
      }

      // Rate limit: wait 200ms between batches
      if (i + batchSize < tokenList.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    // Convert to Blockscout format
    return {
      items: tokenItems,
    };
  } catch (error) {
    console.error("[fetchTokens] Etherscan API error:", error);
    throw error;
  }
}

export async function fetchTokens(address: string, network: SupportedChain): Promise<Array<Token>> {
  try {
    let data: BlockscoutResponse;
    if (!appConfig.useMocks) {
      // Use Etherscan API v2 for supported chains (Ethereum, Base)
      if (!ETHERSCAN_SUPPORTED_CHAINS.includes(network.id)) {
        throw new Error(
          `Chain ${network.id} (${network.name}) is not supported. Only Ethereum (1) and Base (8453) are supported.`
        );
      }

      if (!appConfig.etherscanApiKey) {
        throw new Error("ETHERSCAN_API_KEY is required for token fetching");
      }

      console.log(`[fetchTokens] Using Etherscan API v2 for chain ${network.id} (${network.name})`);
      data = await fetchFromEtherscan(address, network.id, appConfig.etherscanApiKey);
      console.log("[fetchTokens] API response items count:", data?.items?.length || 0);
    } else {
      data = TOKENS_MOCK;
    }

    // TODO: Add pagination fetching
    if (!data?.items) {
      console.warn("[fetchTokens] No items in API response, data:", data);
      return [];
    }

    console.log("[fetchTokens] Total items from API:", data.items.length);

    const filteredItems = data.items.filter((item) => {
      const value = BigInt(item.value || "0");
      const isValid = item.token.type === "ERC-20" && value > BigInt(0);
      if (!isValid) {
        console.debug("[fetchTokens] Filtered out token:", {
          address: item.token.address,
          type: item.token.type,
          value: item.value,
        });
      }
      return isValid;
    });

    console.log("[fetchTokens] Items after filtering:", filteredItems.length);

    return filteredItems.map((item) => {
      const decimals = Number.parseInt(item.token.decimals || "18", 10);
      let rawBalance: bigint;
      try {
        rawBalance = BigInt(item.value);
      } catch {
        rawBalance = BigInt(0);
      }

      const formattedBalance = formatBalance(rawBalance, decimals);

      let price = 0;
      if (item.token.exchange_rate) {
        const parsedPrice = Number.parseFloat(item.token.exchange_rate);
        if (!Number.isNaN(parsedPrice)) {
          price = parsedPrice;
        }
      }

      return {
        address: item.token.address as `0x${string}`,
        symbol: item.token.symbol,
        name: item.token.name,
        decimals,
        balance: formattedBalance.toFixed(4),
        rawBalance,
        logoURI: item.token.icon_url,
        price,
      };
    });
  } catch (error) {
    console.error("Error fetching tokens:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
    }
    return [];
  }
}
