

export abstract class LoginHandler {
    public onReadyCallback: () => void;

    constructor(onLoginHandlerReadyCallback: () => void) {
        this.onReadyCallback = onLoginHandlerReadyCallback;
    }

    public abstract loginState(): string;

    public abstract listRooms(resultCallback);

    public abstract logout();

    public abstract login(username: string, password: string, remember_me: boolean);

    public abstract forgot_password(username: string): Promise<undefined>;
}
