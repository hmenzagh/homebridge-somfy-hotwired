const rpio = require('rpio');
const _ = require('lodash');

let Service, Characteristic;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    homebridge.registerAccessory('homebridge-somfy-hotwired', 'Homebridge-somfy-hotwired', Somfy);
};

function Somfy(log, config) {
    this.service = new Service.WindowCovering(this.name);
    this.log = log;
    if (config.default_position === "up") {
        this.currentPosition = 100;
        this.targetPosition = 100;
    } else {
        this.currentPosition = 0;
        this.targetPosition = 0;
    }

    this.buttonPressDuration = 500;

    this.positionState = Characteristic.PositionState.STOPPED;

    this.pinUp = config['pin_up'];
    this.pinDown = config['pin_down'];
    this.pinMyPosition = config['pin_my_position'];
    this.movementDurationUp = config['movement_duration_up'];
    this.movementDurationDown = config['movement_duration_down'];

    rpio.open(this.pinUp, rpio.OUTPUT, rpio.HIGH);
    rpio.open(this.pinDown, rpio.OUTPUT, rpio.HIGH);
    rpio.open(this.pinMyPosition, rpio.OUTPUT, rpio.HIGH);
}

Somfy.prototype = {
    getCurrentPosition: function (callback) {
        callback(null, this.currentPosition);
    },
    getTargetPosition: function (callback) {
        callback(null, this.targetPosition);
    },
    setTargetPosition: function (position, callback) {
		clearInterval(this.interval);
		this.targetPosition = position;

		if (this.targetPosition === 100) {
			this.log('Opening shutters');

			rpio.write(this.pinUp, rpio.LOW);
			rpio.msleep(this.buttonPressDuration);
			rpio.write(this.pinUp, rpio.HIGH);

			this.intermediatePosition = false;
			this.positionState = Characteristic.PositionState.DECREASING;
		} else if (this.targetPosition === 10) {
			this.log('Going to MySomfy position');

			rpio.write(this.pinMyPosition, rpio.LOW);
			rpio.msleep(this.buttonPressDuration);
			rpio.write(this.pinMyPosition, rpio.HIGH);
			this.intermediatePosition = false;
			if (this.targetPosition > this.currentPosition) {
				this.positionState = Characteristic.PositionState.INCREASING;
			} else {
				this.positionState = Characteristic.PositionState.DECREASING;
			}
		} else if (this.targetPosition === 0) {
			this.log('Closing shutters');

			rpio.write(this.pinDown, rpio.LOW);
			rpio.msleep(this.buttonPressDuration);
			rpio.write(this.pinDown, rpio.HIGH);
			this.intermediatePosition = false;
			this.positionState = Characteristic.PositionState.INCREASING;
		} else {
			this.log('Opening shutters to %i percent', this.targetPosition);

			let pin = null;
			if (this.targetPosition > this.currentPosition) {
				pin = this.pinUp;
				this.positionState = Characteristic.PositionState.INCREASING;
			} else {
				pin = this.pinDown
				this.positionState = Characteristic.PositionState.DECREASING;
			}

			rpio.write(pin, rpio.LOW);
			rpio.msleep(this.buttonPressDuration);
			rpio.write(pin, rpio.HIGH);

			this.intermediatePosition = true;
		}

		const tick = () => {
			if (this.currentPosition !== this.targetPosition) {
				if (this.targetPosition > this.currentPosition) {
					this.currentPosition += 10;
				} else {
					this.currentPosition -= 10;
				}
				this.service.getCharacteristic(Characteristic.CurrentPosition).updateValue(this.currentPosition);
			} else {

				if (this.intermediatePosition) {
					rpio.write(this.pinMyPosition, rpio.LOW);
					rpio.msleep(this.buttonPressDuration);
					rpio.write(this.pinMyPosition, rpio.HIGH);
				}

				this.log('Operation completed!');

				this.positionState = Characteristic.PositionState.STOPPED;
				this.service.getCharacteristic(Characteristic.PositionState).updateValue(this.positionState);
				clearInterval(this.interval);
			}

		};

		const baseDuration = this.positionState === Characteristic.PositionState.INCREASING ?
			this.movementDurationUp : this.movementDurationDown;
		
		tick();
		this.interval = setInterval(tick, baseDuration * 100);

        callback(null);
    },
    getPositionState: function (callback) {
        callback(null, this.positionState);
    },

    getServices: function () {
        const informationService = new Service.AccessoryInformation();
        informationService
            .setCharacteristic(Characteristic.Manufacturer, "Somfy")
            .setCharacteristic(Characteristic.Model, "Telis 1 RTS")
            .setCharacteristic(Characteristic.SerialNumber, "1337");

        const currentPositionChar = this.service.getCharacteristic(Characteristic.CurrentPosition);
        currentPositionChar.on('get', this.getCurrentPosition.bind(this));

        const targetPositionChar = this.service.getCharacteristic(Characteristic.TargetPosition);
        targetPositionChar.setProps({
            format: Characteristic.Formats.UINT8,
            unit: Characteristic.Units.PERCENTAGE,
            maxValue: 100,
            minValue: 0,
            minStep: 10,
            perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
        });

		const averageDuration = (this.movementDurationUp + this.movementDurationDown) / 2
		const debouncedSetTargetPosition = _.debounce(this.setTargetPosition.bind(this), averageDuration * 100)

        targetPositionChar.on('get', this.getTargetPosition.bind(this));
        targetPositionChar.on('set', debouncedSetTargetPosition);

        this.service.getCharacteristic(Characteristic.PositionState)
            .on('get', this.getPositionState.bind(this));

        return [informationService, this.service];
    }
};
