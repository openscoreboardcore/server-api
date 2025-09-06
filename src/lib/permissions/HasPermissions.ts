// export default function HasPermissions(permissions: string[]) {
// 	return function (req: Request, res: Response, next: NextFunction) {
// 		const userPermissions = req.user?.permissions || [];
// 		const hasPermission = permissions.some((permission) =>
// 			userPermissions.includes(permission)
// 		);
// 		if (!hasPermission) {
// 			return res.status(403).json({ message: "Forbidden" });
// 		}
// 		next();
// 	};
// }
