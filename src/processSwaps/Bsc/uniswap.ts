import { ethers } from "ethers";

export const v3SwapTopic =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
export const v2SwapTopic =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";
export const v2BurnTopic =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
export const v2MintTopic =
  "0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f";
export const v2SyncTopic =
  "0x1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1";
export const approvalTopic =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";
export const poolCreatedTopic =
  "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118";
export const pairCreatedTopic =
  "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9";

export const PANCAKE_V3_FACTORY = "0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7";
export const PANCAKE_V2_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
export const SWAP_ROUTER_02 = "0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2";
export const NONFUNGIBLE_POSITION_MANAGER =
  "0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613";
export const QUOTER_V2 = "0x78D78E420Da98ad378D7799bE8f4AF69033EB077";
export const UNIVERSAL_ROUTER = "0x1906c1d672b88cd1b9ac7593301ca990f94eae07";

export interface ITokenAddress {
  tokenAddress: string;
  totalSupply: number;
  decimals: number;
  pairAddress: string;
  price: string;
  customToken?: boolean;
  solPad?: boolean;
  pumpfun?: boolean;
  associatedSwapAddresses?: string[];
  pumpaiToken?: boolean;
  sunpump?: boolean;
  moonshot?: boolean;
  pinksale?: boolean;
  degen?: boolean;
  etherVista?: boolean;
  fjordData?: {
    qouteDecimals: number;
    qouteTokenAddress: string;
  };
}

export enum pairs {
  WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  USDT = "0x55d398326f99059ff775485246999027b3197955",
  USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  BUSD = "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56",
  CAKE = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
}

export const processPancake = async (
  tokensAddress: ITokenAddress[],
  logs: any,
  tx: any,
  chainSymbol: string,
  bnbPrice: number
) => {
  try {
    console.log("Exported functions from pancake:", {
      processPancake: typeof processPancake,
    });

    if (tokensAddress.length === 0) {
      return null;
    }

    const eventSignatures = {
      Transfer: "Transfer(address,address,uint256)",
      SwapV3: "Swap(address,address,int256,int256,uint160,uint128,int24)",
      SwapV2: "Swap(address,uint256,uint256,uint256,uint256,address)",
      PoolCreated: "PoolCreated(address,address,uint24,int24,address)",
      PairCreated: "PairCreated(address,address,address,uint256)",
      Mint: "Mint(address,uint256,uint256)",
      Burn: "Burn(address,uint256,uint256,address,uint256)",
      Sync: "Sync(uint112,uint112)",
      Approval: "Approval(address,address,uint256)",
    };

    const mappedLogs = logs
      .map((log: any) => {
        try {
          let iface;
          if (log.topics[0] === ethers.utils.id(eventSignatures.Transfer)) {
            iface = new ethers.utils.Interface([
              {
                anonymous: false,
                inputs: [
                  {
                    indexed: true,
                    internalType: "address",
                    name: "from",
                    type: "address",
                  },
                  {
                    indexed: true,
                    internalType: "address",
                    name: "to",
                    type: "address",
                  },
                  {
                    indexed: false,
                    internalType: "uint256",
                    name: "value",
                    type: "uint256",
                  },
                ],
                name: "Transfer",
                type: "event",
              },
            ]);
          } else if (log.topics[0] === v2MintTopic) {
            iface = new ethers.utils.Interface([
              {
                anonymous: false,
                inputs: [
                  {
                    indexed: true,
                    internalType: "address",
                    name: "sender",
                    type: "address",
                  },
                  {
                    indexed: false,
                    internalType: "uint256",
                    name: "amount0",
                    type: "uint256",
                  },
                  {
                    indexed: false,
                    internalType: "uint256",
                    name: "amount1",
                    type: "uint256",
                  },
                ],
                name: "Mint",
                type: "event",
              },
            ]);
            const parsedLog = iface.parseLog(log);
            return {
              address: log.address,
              ...parsedLog,
              name: "Mint",
            };
          } else if (log.topics[0] === v2BurnTopic) {
            iface = new ethers.utils.Interface([
              {
                anonymous: false,
                inputs: [
                  {
                    indexed: true,
                    internalType: "address",
                    name: "sender",
                    type: "address",
                  },
                  {
                    indexed: false,
                    internalType: "uint256",
                    name: "amount0",
                    type: "uint256",
                  },
                  {
                    indexed: false,
                    internalType: "uint256",
                    name: "amount1",
                    type: "uint256",
                  },
                  {
                    indexed: true,
                    internalType: "address",
                    name: "to",
                    type: "address",
                  },
                  {
                    indexed: false,
                    internalType: "uint256",
                    name: "amountETH",
                    type: "uint256",
                  },
                ],
                name: "Burn",
                type: "event",
              },
            ]);
            const parsedLog = iface.parseLog(log);
            return {
              address: log.address,
              ...parsedLog,
              name: "Burn",
            };
          } else if (log.topics[0] === v2SyncTopic) {
            iface = new ethers.utils.Interface([
              {
                anonymous: false,
                inputs: [
                  {
                    indexed: false,
                    internalType: "uint112",
                    name: "reserve0",
                    type: "uint112",
                  },
                  {
                    indexed: false,
                    internalType: "uint112",
                    name: "reserve1",
                    type: "uint112",
                  },
                ],
                name: "Sync",
                type: "event",
              },
            ]);
            const parsedLog = iface.parseLog(log);
            return {
              address: log.address,
              ...parsedLog,
              name: "Sync",
            };
          } else if (log.topics[0] === approvalTopic) {
            iface = new ethers.utils.Interface([
              {
                anonymous: false,
                inputs: [
                  {
                    indexed: true,
                    internalType: "address",
                    name: "owner",
                    type: "address",
                  },
                  {
                    indexed: true,
                    internalType: "address",
                    name: "spender",
                    type: "address",
                  },
                  {
                    indexed: false,
                    internalType: "uint256",
                    name: "value",
                    type: "uint256",
                  },
                ],
                name: "Approval",
                type: "event",
              },
            ]);
            const parsedLog = iface.parseLog(log);
            return {
              address: log.address,
              ...parsedLog,
              name: "Approval",
            };
          } else if (
            log.topics[0] === v3SwapTopic ||
            log.topics[0] === v2SwapTopic
          ) {
            // Same topic for V2 and V3 Swap
            let parsedLog;
            try {
              // Try V3 first
              iface = new ethers.utils.Interface([
                {
                  anonymous: false,
                  inputs: [
                    {
                      indexed: true,
                      internalType: "address",
                      name: "sender",
                      type: "address",
                    },
                    {
                      indexed: true,
                      internalType: "address",
                      name: "recipient",
                      type: "address",
                    },
                    {
                      indexed: false,
                      internalType: "int256",
                      name: "amount0",
                      type: "int256",
                    },
                    {
                      indexed: false,
                      internalType: "int256",
                      name: "amount1",
                      type: "int256",
                    },
                    {
                      indexed: false,
                      internalType: "uint160",
                      name: "sqrtPriceX96",
                      type: "uint160",
                    },
                    {
                      indexed: false,
                      internalType: "uint128",
                      name: "liquidity",
                      type: "uint128",
                    },
                    {
                      indexed: false,
                      internalType: "int24",
                      name: "tick",
                      type: "int24",
                    },
                  ],
                  name: "Swap",
                  type: "event",
                },
              ]);
              parsedLog = iface.parseLog(log);
              return {
                address: log.address,
                ...parsedLog,
                name: "SwapV3",
              };
            } catch (v3Error) {
              // Fallback to V2
              iface = new ethers.utils.Interface([
                {
                  anonymous: false,
                  inputs: [
                    {
                      indexed: true,
                      internalType: "address",
                      name: "sender",
                      type: "address",
                    },
                    {
                      indexed: false,
                      internalType: "uint256",
                      name: "amount0In",
                      type: "uint256",
                    },
                    {
                      indexed: false,
                      internalType: "uint256",
                      name: "amount1In",
                      type: "uint256",
                    },
                    {
                      indexed: false,
                      internalType: "uint256",
                      name: "amount0Out",
                      type: "uint256",
                    },
                    {
                      indexed: false,
                      internalType: "uint256",
                      name: "amount1Out",
                      type: "uint256",
                    },
                    {
                      indexed: true,
                      internalType: "address",
                      name: "to",
                      type: "address",
                    },
                  ],
                  name: "Swap",
                  type: "event",
                },
              ]);
              parsedLog = iface.parseLog(log);
              return {
                address: log.address,
                ...parsedLog,
                name: "SwapV2",
              };
            }
          } else if (log.topics[0] === poolCreatedTopic) {
            iface = new ethers.utils.Interface([
              {
                anonymous: false,
                inputs: [
                  {
                    indexed: true,
                    internalType: "address",
                    name: "token0",
                    type: "address",
                  },
                  {
                    indexed: true,
                    internalType: "address",
                    name: "token1",
                    type: "address",
                  },
                  {
                    indexed: true,
                    internalType: "uint24",
                    name: "fee",
                    type: "uint24",
                  },
                  {
                    indexed: false,
                    internalType: "int24",
                    name: "tickSpacing",
                    type: "int24",
                  },
                  {
                    indexed: false,
                    internalType: "address",
                    name: "pool",
                    type: "address",
                  },
                ],
                name: "PoolCreated",
                type: "event",
              },
            ]);
            const parsedLog = iface.parseLog(log);
            if (parsedLog.name === "PoolCreated") {
              const object = {
                token0: parsedLog.args.token0,
                token1: parsedLog.args.token1,
                fee: parsedLog.args.fee?.toString(),
                tickSpacing: parsedLog.args.tickSpacing?.toString(),
                pool: parsedLog.args.pool,
              };
              return {
                address: log.address,
                ...object,
                args: object,
                name: parsedLog.name,
              };
            }
          } else if (log.topics[0] === pairCreatedTopic) {
            iface = new ethers.utils.Interface([
              {
                anonymous: false,
                inputs: [
                  {
                    indexed: true,
                    internalType: "address",
                    name: "token0",
                    type: "address",
                  },
                  {
                    indexed: true,
                    internalType: "address",
                    name: "token1",
                    type: "address",
                  },
                  {
                    indexed: false,
                    internalType: "address",
                    name: "pair",
                    type: "address",
                  },
                  {
                    indexed: false,
                    internalType: "uint256",
                    name: "",
                    type: "uint256",
                  },
                ],
                name: "PairCreated",
                type: "event",
              },
            ]);
            const parsedLog = iface.parseLog(log);
            if (parsedLog.name === "PairCreated") {
              const object = {
                token0: parsedLog.args.token0,
                token1: parsedLog.args.token1,
                pair: parsedLog.args.pair,
                pairCount: parsedLog.args[""]?.toString(),
              };
              return {
                address: log.address,
                ...object,
                args: object,
                name: parsedLog.name,
              };
            }
          } else {
            console.warn(`Unknown event signature: ${log.topics[0]}`);
            return undefined;
          }

          const parsedLog = iface.parseLog(log);
          return {
            address: log.address,
            ...parsedLog,
          };
        } catch (error) {
          console.error(`Failed to parse log:`, log, error);
          return undefined;
        }
      })
      .filter((x: any) => x && x);
    console.log({ mappedLogs });

    // Handle creation events
    const poolCreatedLog = mappedLogs.find(
      (x: any) => x.name === "PoolCreated"
    );
    const pairCreatedLog = mappedLogs.find(
      (x: any) => x.name === "PairCreated"
    );
    if (poolCreatedLog || pairCreatedLog) {
      const createdLog = poolCreatedLog || pairCreatedLog;
      const factory = poolCreatedLog ? PANCAKE_V3_FACTORY : PANCAKE_V2_FACTORY;
      if (createdLog.address.toLowerCase() !== factory.toLowerCase()) {
        console.warn(`${createdLog.name} not from factory`);
        return null;
      }
      let tokenMatch = tokensAddress.find(
        (t: any) =>
          t.tokenAddress.toLowerCase() ===
            createdLog.args.token0.toLowerCase() ||
          t.tokenAddress.toLowerCase() === createdLog.args.token1.toLowerCase()
      );
      const provider = ethers.getDefaultProvider("bsc");
      const erc20Abi = [
        "function decimals() external view returns (uint8)",
        "function totalSupply() external view returns (uint256)",
      ];
      if (!tokenMatch) {
        console.log("No matching token in input, fetching info for tokens");
        console.log("Token0 address:", createdLog.args.token0);
        console.log("Token1 address:", createdLog.args.token1);
        let token0Decimals = 18;
        let token0Supply = 0;
        let token1Decimals = 18;
        let token1Supply = 0;
        try {
          if (createdLog.args.token0.toLowerCase() !== factory.toLowerCase()) {
            const token0Contract = new ethers.Contract(
              createdLog.args.token0,
              erc20Abi,
              provider
            );
            [token0Decimals, token0Supply] = await Promise.all([
              token0Contract.decimals(),
              token0Contract.totalSupply(),
            ]);
          } else {
            console.warn("Skipping fetch for token0: it's the factory");
          }
        } catch (e) {
          console.log(
            "Failed to fetch decimals/supply for token0:",
            createdLog.args.token0,
            e
          );
          token0Decimals = 18; // default
        }
        try {
          if (createdLog.args.token1.toLowerCase() !== factory.toLowerCase()) {
            const token1Contract = new ethers.Contract(
              createdLog.args.token1,
              erc20Abi,
              provider
            );
            [token1Decimals, token1Supply] = await Promise.all([
              token1Contract.decimals(),
              token1Contract.totalSupply(),
            ]);
          } else {
            console.warn("Skipping fetch for token1: it's the factory");
          }
        } catch (e) {
          console.log(
            "Failed to fetch decimals/supply for token1:",
            createdLog.args.token1,
            e
          );
          token1Decimals = 18; // default
        }
        // Pick the non-WBNB token as main
        const wbnb = pairs.WBNB.toLowerCase();
        const mainTokenAddress =
          createdLog.args.token0.toLowerCase() === wbnb
            ? createdLog.args.token1
            : createdLog.args.token0;
        const mainDecimals =
          createdLog.args.token0.toLowerCase() === wbnb
            ? token1Decimals
            : token0Decimals;
        const mainSupply =
          createdLog.args.token0.toLowerCase() === wbnb
            ? token1Supply
            : token0Supply;
        tokenMatch = {
          tokenAddress: mainTokenAddress,
          totalSupply: parseInt(
            ethers.utils.formatUnits(mainSupply, mainDecimals)
          ),
          decimals: mainDecimals,
          pairAddress: createdLog.args.pair || createdLog.args.pool,
          price: "0",
        };
      } else if (tokenMatch.decimals === 0 || !tokenMatch.decimals) {
        // Fetch if missing
        try {
          console.log(
            "Fetching missing decimals for matched token:",
            tokenMatch.tokenAddress
          );
          const tokenContract = new ethers.Contract(
            tokenMatch.tokenAddress,
            erc20Abi,
            provider
          );
          const [decimals, totalSupply] = await Promise.all([
            tokenContract.decimals(),
            tokenContract.totalSupply(),
          ]);
          tokenMatch.decimals = decimals;
          tokenMatch.totalSupply = parseInt(
            ethers.utils.formatUnits(totalSupply, decimals)
          );
        } catch (e) {
          console.log(
            "Failed to fetch decimals/supply for matched token:",
            tokenMatch.tokenAddress,
            e
          );
          tokenMatch.decimals = 18; // default
        }
      }
      if (!tokenMatch) {
        console.log("No matching token for pool/pair creation");
        return null;
      }
      console.log({ [`${createdLog.name}Data`]: createdLog, tokenMatch });

      const fee = createdLog.name === "PoolCreated" ? createdLog.args.fee : "0";
      const tickSpacing =
        createdLog.name === "PoolCreated" ? createdLog.args.tickSpacing : "0";
      const pairAddress =
        createdLog.name === "PoolCreated"
          ? createdLog.args.pool
          : createdLog.args.pair;

      let dataObject = {
        event: createdLog.name,
        token: tokenMatch.tokenAddress,
        pairAddress,
        fee: fee?.toString(),
        tickSpacing: tickSpacing?.toString(),
        token0: createdLog.args.token0,
        token1: createdLog.args.token1,
        creator: tx.from,
        hash: tx.hash || tx.transactionHash,
        tokenData: tokenMatch,
        type: "create",
      };

      console.log({
        dataObject,
        type: "pancakecreate",
      });

      return dataObject;
    }

    // Handle liquidity events (Mint/Burn)
    const mintLog = mappedLogs.find((x: any) => x.name === "Mint");
    if (mintLog) {
      const log = mintLog;
      const token = tokensAddress.find(
        (x: any) => x.pairAddress.toLowerCase() === log.address.toLowerCase()
      );
      console.log({ token });
      if (!token) return;

      const provider = ethers.getDefaultProvider("bsc");

      const pairAbi = [
        "function token0() external view returns (address)",
        "function token1() external view returns (address)",
      ];
      const pairContract = new ethers.Contract(log.address, pairAbi, provider);
      const [token0, token1] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
      ]);

      const wbnb = pairs.WBNB.toLowerCase();
      const isWbnbToken0 = token0.toLowerCase() === wbnb;
      const tokenIsWbnb = token.tokenAddress.toLowerCase() === wbnb;
      if (tokenIsWbnb) {
        console.log("Token is WBNB, skipping liquidity");
        return;
      }

      // Assume token is the non-WBNB
      const bnbAmountSum = parseFloat(
        ethers.utils.formatUnits(
          isWbnbToken0 ? log.args.amount0 : log.args.amount1,
          18
        )
      );
      const tokenAmountSum = parseFloat(
        ethers.utils.formatUnits(
          isWbnbToken0 ? log.args.amount1 : log.args.amount0,
          token.decimals
        )
      );

      if (bnbAmountSum === 0 || tokenAmountSum === 0) return;

      const usdAmount = bnbAmountSum * bnbPrice;
      const fundsRaised = 0;

      let dataObject = {
        tokenAmountSum,
        spent: usdAmount,
        raised: fundsRaised,
        basePrice: bnbPrice,
        price: usdAmount / tokenAmountSum,
        nativeAmountSum: bnbAmountSum,
        hash: tx.hash || tx.transactionHash,
        from: tx.from,
        tokenData: token,
        typeSwap: "addLiquidity",
      };

      console.log({
        dataObject,
        type: "pancakemintevents",
      });

      return dataObject;
    }

    const burnLog = mappedLogs.find((x: any) => x.name === "Burn");
    if (burnLog) {
      const log = burnLog;
      const token = tokensAddress.find(
        (x: any) => x.pairAddress.toLowerCase() === log.address.toLowerCase()
      );
      console.log({ token });
      if (!token) return;

      const provider = ethers.getDefaultProvider("bsc");

      const pairAbi = [
        "function token0() external view returns (address)",
        "function token1() external view returns (address)",
      ];
      const pairContract = new ethers.Contract(log.address, pairAbi, provider);
      const [token0, token1] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
      ]);

      const wbnb = pairs.WBNB.toLowerCase();
      const isWbnbToken0 = token0.toLowerCase() === wbnb;
      const tokenIsWbnb = token.tokenAddress.toLowerCase() === wbnb;
      if (tokenIsWbnb) {
        console.log("Token is WBNB, skipping liquidity");
        return;
      }

      // Assume token is the non-WBNB
      const bnbAmountSum = parseFloat(
        ethers.utils.formatUnits(
          isWbnbToken0 ? log.args.amount0 : log.args.amount1,
          18
        )
      );
      const tokenAmountSum = parseFloat(
        ethers.utils.formatUnits(
          isWbnbToken0 ? log.args.amount1 : log.args.amount0,
          token.decimals
        )
      );

      if (bnbAmountSum === 0 || tokenAmountSum === 0) return;

      const usdAmount = bnbAmountSum * bnbPrice;
      const fundsRaised = 0;

      let dataObject = {
        tokenAmountSum,
        spent: usdAmount,
        raised: fundsRaised,
        basePrice: bnbPrice,
        price: usdAmount / tokenAmountSum,
        nativeAmountSum: bnbAmountSum,
        hash: tx.hash || tx.transactionHash,
        from: tx.from,
        tokenData: token,
        typeSwap: "removeLiquidity",
      };

      console.log({
        dataObject,
        type: "pancakeburnevents",
      });

      return dataObject;
    }

    // Handle swaps
    const swapV3Log = mappedLogs.find((x: any) => x.name === "SwapV3");
    if (swapV3Log) {
      const log = swapV3Log;
      const token = tokensAddress.find(
        (x: any) => x.pairAddress.toLowerCase() === log.address.toLowerCase()
      );
      console.log({ token });
      if (!token) return;

      const provider = ethers.getDefaultProvider("bsc");

      const pairAbi = [
        "function token0() external view returns (address)",
        "function token1() external view returns (address)",
      ];
      const pairContract = new ethers.Contract(log.address, pairAbi, provider);
      const [token0, token1] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
      ]);

      const isToken0 =
        token.tokenAddress.toLowerCase() === token0.toLowerCase();
      const wbnb = pairs.WBNB.toLowerCase();
      const otherToken = isToken0 ? token1.toLowerCase() : token0.toLowerCase();
      if (otherToken !== wbnb) {
        console.log("Not a WBNB pair, skipping");
        return;
      }

      const amount0 = log.args.amount0;
      const amount1 = log.args.amount1;
      const tokenDelta = isToken0 ? amount0 : amount1;
      const nativeDelta = isToken0 ? amount1 : amount0;

      const tokenAbs = tokenDelta.abs();
      const nativeAbs = nativeDelta.abs();

      let tokenAmountSum = parseFloat(
        ethers.utils.formatUnits(tokenAbs, token.decimals)
      );
      let bnbAmountSum = parseFloat(ethers.utils.formatUnits(nativeAbs, 18));
      let typeSwap: "buy" | "sell" = tokenDelta.gt(0) ? "sell" : "buy";

      console.log({ tokenAmountSum, bnbAmountSum });

      if (bnbAmountSum === 0 || tokenAmountSum === 0) return;

      const usdAmount = bnbAmountSum * bnbPrice;
      const fundsRaised = 0;

      let dataObject = {
        tokenAmountSum,
        spent: usdAmount,
        raised: fundsRaised,
        basePrice: bnbPrice,
        price: usdAmount / tokenAmountSum,
        nativeAmountSum: bnbAmountSum,
        hash: tx.hash || tx.transactionHash,
        from: tx.from,
        tokenData: token,
        typeSwap,
      };

      console.log({
        dataObject,
        type: "pancakev3events",
      });

      return dataObject;
    }

    const swapV2Log = mappedLogs.find((x: any) => x.name === "SwapV2");
    if (swapV2Log) {
      const log = swapV2Log;
      const token = tokensAddress.find(
        (x: any) => x.pairAddress.toLowerCase() === log.address.toLowerCase()
      );
      console.log({ token });
      if (!token) return;

      if (log.args.sender.toLowerCase() !== tx.from.toLowerCase()) {
        console.log("Sender mismatch for V2 swap");
        return;
      }

      const provider = ethers.getDefaultProvider("bsc");

      const pairAbi = [
        "function token0() external view returns (address)",
        "function token1() external view returns (address)",
      ];
      const pairContract = new ethers.Contract(log.address, pairAbi, provider);
      const [token0, token1] = await Promise.all([
        pairContract.token0(),
        pairContract.token1(),
      ]);

      const isToken0 =
        token.tokenAddress.toLowerCase() === token0.toLowerCase();
      const wbnb = pairs.WBNB.toLowerCase();
      const otherToken = isToken0 ? token1.toLowerCase() : token0.toLowerCase();
      if (otherToken !== wbnb) {
        console.log("Not a WBNB pair, skipping");
        return;
      }

      // Use swap args for precise amounts (out/in)
      let tokenAmountSum = 0;
      let bnbAmountSum = 0;
      let typeSwap: "buy" | "sell" | undefined;

      const amount0In = log.args.amount0In;
      const amount1In = log.args.amount1In;
      const amount0Out = log.args.amount0Out;
      const amount1Out = log.args.amount1Out;

      if (isToken0) {
        // Token is token0
        const tokenIn = amount0In.gt(0);
        if (tokenIn) {
          // Sell: token in, WBNB out
          tokenAmountSum = parseFloat(
            ethers.utils.formatUnits(amount0In, token.decimals)
          );
          bnbAmountSum = parseFloat(ethers.utils.formatUnits(amount1Out, 18));
          typeSwap = "sell";
        } else {
          // Buy: token out, WBNB in
          tokenAmountSum = parseFloat(
            ethers.utils.formatUnits(amount0Out, token.decimals)
          );
          bnbAmountSum = parseFloat(ethers.utils.formatUnits(amount1In, 18));
          typeSwap = "buy";
        }
      } else {
        // Token is token1
        const tokenIn = amount1In.gt(0);
        if (tokenIn) {
          // Sell: token in, WBNB out
          tokenAmountSum = parseFloat(
            ethers.utils.formatUnits(amount1In, token.decimals)
          );
          bnbAmountSum = parseFloat(ethers.utils.formatUnits(amount0Out, 18));
          typeSwap = "sell";
        } else {
          // Buy: token out, WBNB in
          tokenAmountSum = parseFloat(
            ethers.utils.formatUnits(amount1Out, token.decimals)
          );
          bnbAmountSum = parseFloat(ethers.utils.formatUnits(amount0In, 18));
          typeSwap = "buy";
        }
      }

      console.log({ tokenAmountSum, bnbAmountSum, typeSwap });

      if (bnbAmountSum === 0 || tokenAmountSum === 0 || !typeSwap) return;

      const usdAmount = bnbAmountSum * bnbPrice;
      const fundsRaised = 0;

      let dataObject = {
        tokenAmountSum,
        spent: usdAmount,
        raised: fundsRaised,
        basePrice: bnbPrice,
        price: usdAmount / tokenAmountSum,
        nativeAmountSum: bnbAmountSum,
        hash: tx.hash || tx.transactionHash,
        from: tx.from,
        tokenData: token,
        typeSwap,
      };

      console.log({
        dataObject,
        type: "pancakev2events",
      });

      return dataObject;
    }

    return null;
  } catch (err: any) {
    console.error(`[processPancake] -- ${err}`);
  }
};
