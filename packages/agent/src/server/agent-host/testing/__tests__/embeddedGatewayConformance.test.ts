import { gatewayConformance } from '../gatewayConformance'
import { createEmbeddedGatewayFixture } from '../../__tests__/embeddedGatewayFixture'

gatewayConformance({
  createFixture: createEmbeddedGatewayFixture,
  replayLevel: 'B',
  paginationLevel: 'keyset',
})
