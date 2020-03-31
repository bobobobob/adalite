import {computeRequiredTxFee} from './helpers/chainlib-wrapper'
import _ from 'lodash'
// import {Input, Output, TxPlan} from '../cardano-wallet'
import {Lovelace} from '../../state'

import NamedError from '../../helpers/NamedError'

import {ADA_DONATION_ADDRESS} from '../constants'

type UTxOInput = {
  txHash: string
  address: string
  coins: Lovelace
  outputIndex: number
}

type AccountInput = {
  address: string
  coins: Lovelace
  counter: number
}

export type Input = UTxOInput | AccountInput

export type Output = {
  address: string
  coins: Lovelace
}

type Delegation = {
  id: string
  ratio: number
}

export type Cert = {
  pools: Array<Delegation>
  address: string
}

export interface TxPlan {
  type: string
  inputs: Array<Input>
  outputs: Array<Output>
  change: Output | null
  cert?: Cert
  fee: Lovelace
}

export function computeTxPlan(
  type,
  chainConfig,
  inputs: Array<Input>,
  outputs: Array<Output>,
  possibleChange?: Output,
  cert?: any // TODO: cert
): TxPlan | null {
  const totalInput = inputs.reduce((acc, input) => acc + input.coins, 0)
  const totalOutput = outputs.reduce((acc, output) => acc + output.coins, 0)

  if (totalOutput > Number.MAX_SAFE_INTEGER) {
    throw NamedError('CoinAmountError')
  }

  const feeWithoutChange = computeRequiredTxFee(chainConfig)(inputs, outputs, cert)

  // Cannot construct transaction plan
  if (totalOutput + feeWithoutChange > totalInput) return null

  // No change necessary, perfect fit or a account tx
  if (totalOutput + feeWithoutChange === totalInput) {
    return {type, inputs, outputs, change: null, cert, fee: feeWithoutChange as Lovelace}
  }

  const feeWithChange = computeRequiredTxFee(chainConfig)(
    inputs,
    [...outputs, possibleChange],
    cert
  )

  if (totalOutput + feeWithChange > totalInput) {
    // We cannot fit the change output into the transaction
    // and jormungandr does check for strict fee equality
    return null
  }

  return {
    type,
    inputs,
    outputs,
    change: {
      address: possibleChange.address,
      coins: (totalInput - totalOutput - feeWithChange) as Lovelace,
    },
    cert,
    fee: feeWithChange as Lovelace,
  }
}

export function selectMinimalTxPlan(
  // TODO refactor to "minimalUtxoTxPlan" and add types
  chainConfig,
  utxos: Array<any>, //utxos
  changeAddress,
  address,
  coins?,
  donationAmount?,
  pools?,
  accountAddress?
): any {
  const profitableUtxos = utxos //utxos.filter(isUtxoProfitable)

  const inputs = []

  const cert = pools
    ? {
      type: 'certificate_stake_delegation',
      pools,
      accountAddress, // TODO: address: accountAddress
    }
    : null
  const outputs = coins ? [{address, coins}] : [] // TODO(merc): rather base it on existence of coins
  if (donationAmount > 0) {
    outputs.push({address: ADA_DONATION_ADDRESS, coins: donationAmount})
  }

  const change = {address: changeAddress, coins: 0 as Lovelace}

  for (let i = 0; i < profitableUtxos.length; i++) {
    inputs.push({type: 'utxo', ...profitableUtxos[i]})
    const plan = computeTxPlan('utxo', chainConfig, inputs, outputs, change, cert)
    if (plan) return plan
  }

  return {estimatedFee: computeRequiredTxFee(chainConfig)(inputs, outputs, cert)}
}

export function computeAccountTxPlan(
  chainConfig,
  dstAddress, // TODO: address
  amount, // TODO: rename to coins
  srcAddress, // TODO: accountAddress
  counter,
  value
): any {
  const accountInput = {
    type: 'account',
    address: srcAddress,
    counter,
  }
  const inputFee = computeRequiredTxFee(chainConfig)([accountInput], [], null)
  const coins = amount + inputFee
  if (coins > value) {
    return null
  }
  const inputs = [
    {
      ...accountInput,
      coins,
    },
  ]
  const outputs = amount ? [{address: dstAddress, coins}] : []

  return computeTxPlan('account', chainConfig, inputs, outputs, null)
}
