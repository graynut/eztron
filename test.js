
const UsdtContractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';


const transfer = async (privateKey, toAddress, amount) => {

  const parameter = [
    { type: 'address', value: toAddress },
    { type: 'uint256', value: Math.floor(amount * 1000000) }
  ];
  const { transfer } = require('./src/smart');
  await transfer(UsdtContractAddress, privateKey, toAddress, amount);







  const { TronWeb } = require('tronweb');
  const tweb = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    headers: { 
      'TRON-PRO-API-KEY': '5fbb22e4-c932-4a5c-bb75-7bc50a1bee0e' 
    },
    privateKey
  });


  console.log('___triggerSmartContract____')
  const tx = await tweb.transactionBuilder.triggerSmartContract(
    UsdtContractAddress,
    'transfer(address,uint256)',
    { feeLimit: 900000000 },
    parameter
  );
  console.dir( tx, { depth: null }) 

  
  const signedTx = await tweb.trx.sign(tx.transaction);
  console.dir( signedTx, { depth: null }) 

  console.log('___sendRawTransaction____')
  const end = await tweb.trx.sendRawTransaction(signedTx);
  console.dir( end, { depth: null }) 

  // return end
}




void (async () => {
  transfer(
    'ad5257bf44eb_____key',
    'TMximwy25Js2oZP5N45YvoAiAEb3zZ2JUx',
    6.22
  )
})();





