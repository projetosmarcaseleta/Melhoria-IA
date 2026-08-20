import 'dotenv/config'
import { getBindingStatus } from '../server/services/channelBindService.js'

async function test() {
  const status = await getBindingStatus('db1-group', '3336196')
  console.log('Status retornado:', JSON.stringify(status, null, 2))
}

test().catch(console.error)
