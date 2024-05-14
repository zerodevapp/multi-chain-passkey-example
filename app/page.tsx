"use client"
import dotenv from "dotenv"
import {
    addressToEmptyAccount,
    createKernelAccount,
    createKernelAccountClient,
    createZeroDevPaymasterClient,
    KernelSmartAccount,
    KernelAccountClient
} from "@zerodev/sdk"
import {
    toWebAuthnKey,
    toMultiChainWebAuthnValidator,
    WebAuthnMode,
    webauthnPrepareMultiUserOpRequest,
    webauthnSignUserOps
} from "@zerodev/multi-chain-validator"
import {
    serializeMultiChainPermissionAccounts,
    deserializePermissionAccount,
    toPermissionValidator
} from "@zerodev/permissions"
import { toECDSASigner } from "@zerodev/permissions/signers"
import { toSudoPolicy } from "@zerodev/permissions/policies"
import {
    bundlerActions,
    deepHexlify,
    ENTRYPOINT_ADDRESS_V07
} from "permissionless"
import React, { useEffect, useState } from "react"
import { createPublicClient, http, Transport, Chain, zeroAddress } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { sepolia, optimismSepolia } from "viem/chains"
import { EntryPoint } from "permissionless/types"

dotenv.config()

const SEPOLIA_PROJECT_ID = process.env.NEXT_PUBLIC_SEPOLIA_PROJECT_ID
const OPTIMISM_SEPOLIA_PROJECT_ID =
    process.env.NEXT_PUBLIC_OPTIMISM_SEPOLIA_PROJECT_ID

const SEPOLIA_BUNDLER_URL = `https://rpc.zerodev.app/api/v2/bundler/${SEPOLIA_PROJECT_ID}`
const SEPOLIA_PAYMASTER_URL = `https://rpc.zerodev.app/api/v2/paymaster/${SEPOLIA_PROJECT_ID}`
const SEPOLIA_PASSKEY_SERVER_URL = `https://passkeys.zerodev.app/api/v3/${SEPOLIA_PROJECT_ID}`

const OPTIMISM_SEPOLIA_BUNDLER_URL = `https://rpc.zerodev.app/api/v2/bundler/${OPTIMISM_SEPOLIA_PROJECT_ID}`
const OPTIMISM_SEPOLIA_PAYMASTER_URL = `https://rpc.zerodev.app/api/v2/paymaster/${OPTIMISM_SEPOLIA_PROJECT_ID}`
const OPTIMISM_SEPOLIA_PASSKEY_SERVER_URL = `https://passkeys.zerodev.app/api/v3/${OPTIMISM_SEPOLIA_PROJECT_ID}`

const SEPOLIA = sepolia
const OPTIMISM_SEPOLIA = optimismSepolia

const getEntryPoint = (): EntryPoint => {
    return ENTRYPOINT_ADDRESS_V07
}

const sepoliaPublicClient = createPublicClient({
    transport: http(SEPOLIA_BUNDLER_URL)
})

const optimismSepoliaPublicClient = createPublicClient({
    transport: http(OPTIMISM_SEPOLIA_BUNDLER_URL)
})

const sepoliaZeroDevPaymasterClient = createZeroDevPaymasterClient({
    chain: SEPOLIA,
    transport: http(SEPOLIA_PAYMASTER_URL),
    entryPoint: getEntryPoint()
})

const optimismSepoliaZeroDevPaymasterClient = createZeroDevPaymasterClient({
    chain: OPTIMISM_SEPOLIA,
    transport: http(OPTIMISM_SEPOLIA_PAYMASTER_URL),
    entryPoint: getEntryPoint()
})

let sepoliaKernelAccount: KernelSmartAccount<EntryPoint>
let sepoliaKernelClient: KernelAccountClient<
    EntryPoint,
    Transport,
    Chain,
    KernelSmartAccount<EntryPoint>
>
let opSepoliaKernelAccount: KernelSmartAccount<EntryPoint>
let opSepoliaKernelClient: KernelAccountClient<
    EntryPoint,
    Transport,
    Chain,
    KernelSmartAccount<EntryPoint>
>

export default function Home() {
    const [mounted, setMounted] = useState(false)
    const [username, setUsername] = useState("")
    const [accountAddress, setAccountAddress] = useState("")
    const [isKernelClientReady, setIsKernelClientReady] = useState(false)
    const [isRegistering, setIsRegistering] = useState(false)
    const [isLoggingIn, setIsLoggingIn] = useState(false)
    const [isSendingUserOps, setIsSendingUserOps] = useState(false)
    const [sepoliaUserOpHash, setSepoliaUserOpHash] = useState("")
    const [opSepoliaUserOpHash, setOpSepoliaUserOpHash] = useState("")
    const [userOpsStatus, setUserOpsStatus] = useState("")

    const createAccountAndClient = async (
        multiChainWebAuthnValidators: any[]
    ) => {
        const sepoliaSessionKeyAccount = privateKeyToAccount(
            generatePrivateKey()
        )

        const optimismSepoliaSessionKeyAccount = privateKeyToAccount(
            generatePrivateKey()
        )

        // create an empty account as the session key signer
        const sepoliaEmptyAccount = addressToEmptyAccount(
            sepoliaSessionKeyAccount.address
        )
        const optimismSepoliaEmptyAccount = addressToEmptyAccount(
            optimismSepoliaSessionKeyAccount.address
        )

        const sepoliaEmptySessionKeySigner = toECDSASigner({
            signer: sepoliaEmptyAccount
        })

        const optimismSepoliaEmptySessionKeySigner = toECDSASigner({
            signer: optimismSepoliaEmptyAccount
        })

        const sudoPolicy = toSudoPolicy({})

        // create a permission validator plugin with empty account signer
        const sepoliaPermissionPlugin = await toPermissionValidator(
            sepoliaPublicClient,
            {
                entryPoint: getEntryPoint(),
                signer: sepoliaEmptySessionKeySigner,
                policies: [sudoPolicy]
            }
        )

        const optimismSepoliaPermissionPlugin = await toPermissionValidator(
            optimismSepoliaPublicClient,
            {
                entryPoint: getEntryPoint(),
                signer: optimismSepoliaEmptySessionKeySigner,
                policies: [sudoPolicy]
            }
        )

        sepoliaKernelAccount = await createKernelAccount(sepoliaPublicClient, {
            entryPoint: getEntryPoint(),
            plugins: {
                sudo: multiChainWebAuthnValidators[0],
                regular: sepoliaPermissionPlugin
            }
        })

        opSepoliaKernelAccount = await createKernelAccount(
            optimismSepoliaPublicClient,
            {
                entryPoint: getEntryPoint(),
                plugins: {
                    sudo: multiChainWebAuthnValidators[1],
                    regular: optimismSepoliaPermissionPlugin
                }
            }
        )

        if (sepoliaKernelAccount.address !== opSepoliaKernelAccount.address) {
            throw new Error("Addresses do not match")
        }

        // serialize multi chain permission account with empty account signer, so get approvals
        const [sepoliaApproval, optimismSepoliaApproval] =
            await serializeMultiChainPermissionAccounts([
                {
                    account: sepoliaKernelAccount
                },
                {
                    account: opSepoliaKernelAccount
                }
            ])

        // get real session key signers
        const sepoliaSessionKeySigner = toECDSASigner({
            signer: sepoliaSessionKeyAccount
        })

        const optimismSepoliaSessionKeySigner = toECDSASigner({
            signer: optimismSepoliaSessionKeyAccount
        })

        // deserialize the permission account with the real session key signers
        const deserializeSepoliaKernelAccount =
            await deserializePermissionAccount(
                sepoliaPublicClient,
                getEntryPoint(),
                sepoliaApproval,
                sepoliaSessionKeySigner
            )

        const deserializeOptimismSepoliaKernelAccount =
            await deserializePermissionAccount(
                optimismSepoliaPublicClient,
                getEntryPoint(),
                optimismSepoliaApproval,
                optimismSepoliaSessionKeySigner
            )

        sepoliaKernelClient = createKernelAccountClient({
            account: deserializeSepoliaKernelAccount,
            chain: SEPOLIA,
            bundlerTransport: http(SEPOLIA_BUNDLER_URL),
            entryPoint: getEntryPoint(),
            middleware: {
                sponsorUserOperation: async ({ userOperation }) => {
                    return sepoliaZeroDevPaymasterClient.sponsorUserOperation({
                        userOperation,
                        entryPoint: getEntryPoint()
                    })
                }
            }
        })

        opSepoliaKernelClient = createKernelAccountClient({
            account: deserializeOptimismSepoliaKernelAccount,
            chain: OPTIMISM_SEPOLIA,
            bundlerTransport: http(OPTIMISM_SEPOLIA_BUNDLER_URL),
            entryPoint: getEntryPoint(),
            middleware: {
                sponsorUserOperation: async ({ userOperation }) => {
                    return optimismSepoliaZeroDevPaymasterClient.sponsorUserOperation(
                        {
                            userOperation,
                            entryPoint: getEntryPoint()
                        }
                    )
                }
            }
        })

        setIsKernelClientReady(true)
        setAccountAddress(sepoliaKernelAccount.address)
    }

    // Function to be called when "Register" is clicked
    const handleRegister = async () => {
        setIsRegistering(true)

        const webAuthnKey = await toWebAuthnKey({
            passkeyName: username,
            passkeyServerUrl: SEPOLIA_PASSKEY_SERVER_URL,
            mode: WebAuthnMode.Register
        })

        const sepoliaMultiChainWebAuthnValidator =
            await toMultiChainWebAuthnValidator(sepoliaPublicClient, {
                passkeyServerUrl: SEPOLIA_PASSKEY_SERVER_URL,
                webAuthnKey,
                entryPoint: ENTRYPOINT_ADDRESS_V07
            })

        const optimismSepoliaMultiChainWebAuthnValidator =
            await toMultiChainWebAuthnValidator(optimismSepoliaPublicClient, {
                passkeyServerUrl: OPTIMISM_SEPOLIA_PASSKEY_SERVER_URL,
                webAuthnKey,
                entryPoint: ENTRYPOINT_ADDRESS_V07
            })

        await createAccountAndClient([
            sepoliaMultiChainWebAuthnValidator,
            optimismSepoliaMultiChainWebAuthnValidator
        ])

        setIsRegistering(false)
        window.alert("Register done.  Try sending UserOps.")
    }

    const handleLogin = async () => {
        setIsLoggingIn(true)

        setIsLoggingIn(false)
        window.alert("Login done.  Try sending UserOps.")
    }

    const handleSendUserOps = async () => {
        setIsSendingUserOps(true)
        setUserOpsStatus("Sending UserOp...")

        const sepoliaTxHash = await sepoliaKernelClient.sendTransaction({
            to: zeroAddress,
            value: BigInt(0),
            data: "0x"
        })

        setSepoliaUserOpHash(sepoliaTxHash)

        const optimismSepoliaTxHash =
            await opSepoliaKernelClient.sendTransaction({
                to: zeroAddress,
                value: BigInt(0),
                data: "0x"
            })

        setOpSepoliaUserOpHash(optimismSepoliaTxHash)

        // Update the message based on the count of UserOps
        const userOpsMessage = `Multi-UserOps completed. <a href="https://sepolia.etherscan.io/tx/${sepoliaTxHash}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700">Sepolia User Op.</a> \n <a href="https://sepolia-optimism.etherscan.io/tx/${optimismSepoliaTxHash}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:text-blue-700">Optimism Sepolia User Op.</a>`

        setUserOpsStatus(userOpsMessage)
        setIsSendingUserOps(false)
    }

    useEffect(() => {
        setMounted(true)
    }, [])

    if (!mounted) return <></>

    // Spinner component for visual feedback during loading states
    const Spinner = () => (
        <svg
            className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
        >
            <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
            ></circle>
            <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
        </svg>
    )

    return (
        <main className="flex items-center justify-center min-h-screen px-4 py-24">
            <div className="w-full max-w-lg mx-auto">
                <h1 className="text-4xl font-semibold text-center mb-12">
                    ZeroDev Multi-Chain Passkeys Demo
                </h1>

                <div className="space-y-4">
                    {/* Account Address Label */}
                    {accountAddress && (
                        <div className="text-center mb-4">
                            Account address:{" "}
                            <a
                                href={`https://jiffyscan.xyz/account/${accountAddress}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:text-blue-700"
                            >
                                {" "}
                                {accountAddress}{" "}
                            </a>
                        </div>
                    )}

                    {/* Input Box */}
                    <input
                        type="text"
                        placeholder="Your username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="p-2 border border-gray-300 rounded-lg w-full"
                    />

                    {/* Register and Login Buttons */}
                    <div className="flex flex-col sm:flex-row sm:space-x-4">
                        {/* Register Button */}
                        <button
                            onClick={handleRegister}
                            disabled={isRegistering || isLoggingIn}
                            className="flex justify-center items-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 w-full"
                        >
                            {isRegistering ? <Spinner /> : "Register"}
                        </button>

                        {/* Login Button */}
                        <button
                            onClick={handleLogin}
                            disabled={isLoggingIn || isRegistering}
                            className="mt-2 sm:mt-0 flex justify-center items-center px-4 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-opacity-50 w-full"
                        >
                            {isLoggingIn ? <Spinner /> : "Login"}
                        </button>
                    </div>

                    {/* Send Multi-Chain UserOps Button */}
                    <div className="flex flex-col items-center w-full">
                        <button
                            onClick={handleSendUserOps}
                            disabled={!isKernelClientReady || isSendingUserOps}
                            className={`px-4 py-2 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-opacity-50 flex justify-center items-center w-full ${
                                isKernelClientReady && !isSendingUserOps
                                    ? "bg-green-500 hover:bg-green-700 focus:ring-green-500"
                                    : "bg-gray-500"
                            }`}
                        >
                            {isSendingUserOps ? (
                                <Spinner />
                            ) : (
                                "Send Multi-Chain UserOps"
                            )}
                        </button>
                        {/* UserOp Status Label */}
                        {sepoliaUserOpHash && opSepoliaUserOpHash && (
                            <div
                                className="mt-4"
                                dangerouslySetInnerHTML={{
                                    __html: userOpsStatus
                                }}
                            />
                        )}
                    </div>
                </div>
            </div>
        </main>
    )
}
