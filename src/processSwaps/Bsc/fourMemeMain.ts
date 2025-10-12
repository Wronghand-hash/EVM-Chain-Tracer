import { ethers } from "ethers";

export const fourMemesPurchaseTopic =
  "0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942";
export const fourMemesTokenSaleTopic =
  "0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19";
export const fourMemesTokenCreateTopic =
  "0x396d5e902b675b032348d3d2e9517ee8f0c4a926603fbc075d3d282ff00cad20";

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
const abi = require("../../abi/bsc/fourmeme.json");
export enum pairs {
  BSC = "0xEC4549caDcE5DA21Df6E6422d448034B5233bFbC",
  USDT = "0x55d398326f99059ff775485246999027b3197955",
  USD1 = "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d",
  ASTER = "0x000ae314e2a2172a039b26378814c252734f556a",
  CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
}
export const processFourMemes = async (
  tokensAddress: ITokenAddress[],
  logs: any,
  tx: any,
  chainSynbol: string,
  bnbPrice: number
) => {
  try {
    if (tokensAddress.length === 0) {
      return null;
    }

    const eventSignatures = {
      Transfer: "Transfer(address,address,uint256)",
      TokenPurchase: "TokenPurchase(address,address,uint256,uint256,uint256)",
      TokenPurchase2:
        "TokenPurchase(address ,address ,uint256 ,uint256 ,uint256 ,uint256 ,uint256 ,uint256)",
    };

    // const iface = new ethers.utils.Interface(abi);
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
          } else if (
            log.topics[0] === ethers.utils.id(eventSignatures.TokenPurchase) ||
            log.topics[0] === ethers.utils.id(eventSignatures.TokenPurchase2) ||
            log.topics[0] === fourMemesPurchaseTopic ||
            log.topics[0] === fourMemesTokenCreateTopic
            // log.topics[0] ===
            //   "0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19" // sell event --- IGNORE ---
          ) {
            iface = new ethers.utils.Interface(abi);
          } else {
            console.warn(`Unknown event signature: ${log.topics[0]}`);
            return undefined;
          }

          const parsedLog = iface.parseLog(log);
          if (
            parsedLog.name === "TokenPurchase" ||
            parsedLog.name === "TokenSale" ||
            parsedLog.name === "TokenCreated"
          ) {
            const object = {
              token: parsedLog.args.token,
              account: parsedLog.args.account,
              price: parsedLog.args.price?.toString(),
              amountToken: parsedLog.args.amount?.toString(),
              costBNB: parsedLog.args.cost?.toString(),
              fee: parsedLog.args.fee?.toString(),
              offers: parsedLog.args.offers?.toString(),
              funds: parsedLog.args.funds?.toString(),
            };
            return {
              address: log.address,
              ...object,
              args: object,
              name: parsedLog.name,
            };
          }
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

    if (mappedLogs.length !== 2) return;

    const log = mappedLogs[0];
    const token = tokensAddress.find(
      (x: any) => x.tokenAddress.toLowerCase() === log.address.toLowerCase()
    );
    console.log({ token });
    if (!token) return;
    const purchaseData = mappedLogs.find(
      (x: any) => x.name === "TokenPurchase" || x.name === "TokenSale"
    );
    if (!purchaseData) return;
    console.log({ purchaseData });

    const amount = parseFloat(
      ethers.utils.formatUnits(purchaseData.args.costBNB, 18)
    );
    const tokenAmountSum = parseFloat(
      ethers.utils.formatUnits(purchaseData.args.amountToken, token.decimals)
    );
    const fundsRaised = parseFloat(
      ethers.utils.formatUnits(purchaseData.args.funds, 18)
    );
    console.log({ amount, tokenAmountSum, fundsRaised });
    if (amount === 0 || tokenAmountSum === 0) return;

    let dataObject = {
      tokenAmountSum,
      spent: amount * bnbPrice,
      raised: fundsRaised,
      basePrice: bnbPrice,
      price: (amount * bnbPrice) / tokenAmountSum,
      nativeAmountSum: amount,
      hash: tx.hash || tx.transactionHash,
      from: tx.from,
      tokenData: token,
      typeSwap: "buy",
    };

    console.log({
      dataObject,
      type: "fourmemesevents",
    });
  } catch (err: any) {
    console.error(`[getContributedAmount] -- ${err}`);
  }
};
