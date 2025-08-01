'use strict';

const sinon = require('sinon');
const chai = require('chai');
const proxyquire = require('proxyquire').noCallThru();
chai.should();

describe('Router tests', () => {
  let appStub;
  let handlers;
  let ModelStub;
  let modelInstance;
  let clearExpiredStub;
  let DataRetentionWindowCalculatorStub;
  let calcInstance;

  const props = {
    modelName: 'asc',
    tableName: 'saved_applications',
    selectableProps: ['id', 'email', 'created_at', 'session'],
    additionalGetResources: ['email'],
    dataRetentionInDays: 14,
    dataRetentionPeriodType: 'business'
  };

  const makeReqRes = ({ params = {}, query = {}, body = {} } = {}) => {
    const req = { params, query, body };
    const res = {
      json: sinon.stub(),
      send: sinon.stub(),
      sendStatus: sinon.stub()
    };
    const next = sinon.stub();
    return { req, res, next };
  };

  const records = [
    {
      id: 1,
      email: 'user@example.com',
      created_at: '2023-05-09',
      session: JSON.stringify({ retention_days: 7 })
    },
    {
      id: 2,
      email: 'other@example.com',
      created_at: '2023-05-09',
      session: { retention_days: 10 }
    }
  ];

  beforeEach(() => {
    handlers = { get: {}, post: {}, patch: {}, delete: {} };
    appStub = {
      get: sinon.stub().callsFake((path, handler) => {
        handlers.get[path] = handler;
      }),
      post: sinon.stub().callsFake((path, handler) => {
        handlers.post[path] = handler;
      }),
      patch: sinon.stub().callsFake((path, handler) => {
        handlers.patch[path] = handler;
      }),
      delete: sinon.stub().callsFake((path, handler) => {
        handlers.delete[path] = handler;
      })
    };

    modelInstance = {
      getInTimeRange: sinon.stub().resolves(records),
      getMetrics: sinon.stub().resolves({ count: 2 }),
      get: sinon.stub().resolves(records),
      create: sinon.stub().resolves(records),
      patch: sinon.stub().resolves(records),
      delete: sinon.stub().resolves()
    };

    ModelStub = sinon.stub().callsFake(function () {
      return modelInstance;
    });

    clearExpiredStub = sinon.stub().resolves();

    calcInstance = {
      getRetentionEndDate: sinon.stub().callsFake(() => '2023-05-23')
    };
    DataRetentionWindowCalculatorStub = sinon.stub().returns(calcInstance);

    const router = proxyquire('../../router', {
      './models/asc': ModelStub,
      './db': { clearExpired: clearExpiredStub },
      './lib/data_retention_window_calculator':
        DataRetentionWindowCalculatorStub
    });

    router(appStub, props);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('GET /:table/history', () => {
    it('should return 400 message when timestamp or from is missing', async () => {
      const path = `/${props.tableName}/history`;
      const { req, res, next } = makeReqRes({
        query: { timestamp: 'created_at' }
      });

      await handlers.get[path](req, res, next);
      res.send.should.have.been.calledOnceWith({
        status: 400,
        message:
          "Please add a 'timestamp' (column name) and 'from' query to your request"
      });
      next.should.not.have.been.called;
    });

    it('should return records with expires_at when retention is configured', async () => {
      const path = `/${props.tableName}/history`;
      const { req, res, next } = makeReqRes({
        query: { timestamp: 'created_at', from: '2023-05-01' }
      });

      await handlers.get[path](req, res, next);
      modelInstance.getInTimeRange.should.have.been.calledOnceWith(req.query);
      res.json.should.have.been.calledOnce;

      const payload = res.json.firstCall.args[0];
      payload.should.be.an('array');
      payload[0].should.have.property('expires_at', '2023-05-23');
      payload[1].should.have.property('expires_at', '2023-05-23');
    });
  });

  describe('GET /:table/metrics', () => {
    it('should return metrics from model', async () => {
      const path = `/${props.tableName}/metrics`;
      const { req, res, next } = makeReqRes({ query: { range: '7d' } });

      await handlers.get[path](req, res, next);
      modelInstance.getMetrics.should.have.been.calledOnceWith(req.query);
      res.json.should.have.been.calledOnceWith({ count: 2 });
      next.should.not.have.been.called;
    });
  });

  describe('GET /:table/:id', () => {
    it('should fetch by id and apply expiry', async () => {
      const path = `/${props.tableName}/:id`;
      const { req, res, next } = makeReqRes({ params: { id: '123' } });

      await handlers.get[path](req, res, next);
      modelInstance.get.should.have.been.calledOnceWith({ id: '123' });
      const payload = res.json.firstCall.args[0];
      payload[0].should.have.property('expires_at', '2023-05-23');
    });
  });

  describe('GET /:table/email/:email', () => {
    it('should decode hex-encoded email param', async () => {
      const hexEmail = Buffer.from('hexed@example.com').toString('hex');
      const path = `/${props.tableName}/email/:email`;
      const { req, res, next } = makeReqRes({ params: { email: hexEmail } });

      await handlers.get[path](req, res, next);
      modelInstance.get.should.have.been.calledOnceWith({
        email: 'hexed@example.com'
      });
      const payload = res.json.firstCall.args[0];
      payload[0].should.have.property('expires_at', '2023-05-23');
    });

    it('should use plain email when already decoded', async () => {
      const path = `/${props.tableName}/email/:email`;
      const { req, res, next } = makeReqRes({
        params: { email: 'plain@example.com' }
      });

      await handlers.get[path](req, res, next);
      modelInstance.get.should.have.been.calledOnceWith({
        email: 'plain@example.com'
      });
      res.json.should.have.been.calledOnce;
    });
  });

  describe('POST /:table', () => {
    it('should create record and return with expiry', async () => {
      const path = `/${props.tableName}`;
      const { req, res, next } = makeReqRes({
        body: { email: 'new@example.com' }
      });

      await handlers.post[path](req, res, next);
      modelInstance.create.should.have.been.calledOnceWith(req.body);
      const payload = res.json.firstCall.args[0];
      payload[0].should.have.property('expires_at', '2023-05-23');
    });
  });

  describe('PATCH /:table/:id', () => {
    it('should patch record and return with expiry', async () => {
      const path = `/${props.tableName}/:id`;
      const { req, res, next } = makeReqRes({
        params: { id: '1' },
        body: { status: 'updated' }
      });

      await handlers.patch[path](req, res, next);
      modelInstance.patch.should.have.been.calledOnceWith('1', {
        status: 'updated'
      });
      const payload = res.json.firstCall.args[0];
      payload[0].should.have.property('expires_at', '2023-05-23');
    });
  });

  describe('DELETE /:table/:id', () => {
    it('should delete and return 200', async () => {
      const path = `/${props.tableName}/:id`;
      const { req, res, next } = makeReqRes({ params: { id: '5' } });

      await handlers.delete[path](req, res, next);
      modelInstance.delete.should.have.been.calledOnceWith('5');
      res.sendStatus.should.have.been.calledOnceWith(200);
    });
  });

  describe('DELETE /:table/clear/:status/:dateType/older/:days/:periodType', () => {
    it('should call clearExpired with params and return 200', async () => {
      const path = `/${props.tableName}/clear/:status/:dateType/older/:days/:periodType`;
      const { req, res, next } = makeReqRes({
        params: {
          status: 'completed',
          dateType: 'created_at',
          days: '30',
          periodType: 'calendar'
        }
      });

      await handlers.delete[path](req, res, next);
      clearExpiredStub.should.have.been.calledOnceWith(
        props.tableName,
        '30',
        'calendar',
        'completed',
        'created_at'
      );
      res.sendStatus.should.have.been.calledOnceWith(200);
    });
  });
});
